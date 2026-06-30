#!/usr/bin/env bash

set -euo pipefail

NAMESPACE="${KUBERNETES_NAMESPACE:-grocery}"
BOOTSTRAP_MARKER="grocery-bootstrap-state"
BOOTSTRAP_SECRET="grocery-bootstrap-config"
APP_SECRET="grocery-app-config"

required=(
  IMAGE_REFERENCE
  RELEASE_ID
  APP_HOSTNAME
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  NEXTAUTH_SECRET
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing deployment value: ${name}" >&2
    exit 1
  fi
done

if [[ ! "$IMAGE_REFERENCE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]; then
  echo "IMAGE_REFERENCE must be an immutable lowercase GHCR digest." >&2
  exit 1
fi
if [[ ! "$RELEASE_ID" =~ ^[a-f0-9]{40}$ ]]; then
  echo "RELEASE_ID must be a full Git commit SHA." >&2
  exit 1
fi
if [[ ! "$APP_HOSTNAME" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "APP_HOSTNAME must be a DNS hostname without a scheme or path." >&2
  exit 1
fi
if (( ${#NEXTAUTH_SECRET} < 32 )); then
  echo "NEXTAUTH_SECRET must contain at least 32 characters." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
bootstrap_secret_created=false
cleanup() {
  rm -rf "$work_dir"
  if [[ "$bootstrap_secret_created" == true ]]; then
    kubectl --namespace "$NAMESPACE" delete secret "$BOOTSTRAP_SECRET" --ignore-not-found >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

kubectl get namespace "$NAMESPACE" >/dev/null
kubectl --namespace "$NAMESPACE" get secret database >/dev/null
kubectl --namespace "$NAMESPACE" get configmap postgres-ca >/dev/null

render_component() {
  local source_dir="$1"
  local output_dir="$2"
  local name_suffix="${3:-}"
  mkdir -p "$output_dir/base"
  cp -R "$source_dir"/. "$output_dir/base/"
  cat > "$output_dir/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - base
images:
  - name: grocery-app-image
    newName: ${IMAGE_REFERENCE%@*}
    digest: ${IMAGE_REFERENCE#*@}
EOF
  if [[ -n "$name_suffix" ]]; then
    printf 'nameSuffix: %s\n' "$name_suffix" >> "$output_dir/kustomization.yaml"
  fi
  kubectl kustomize "$output_dir" > "$output_dir/rendered.yaml"
}

create_app_secret() {
  local secret_dir="$work_dir/application-secret"
  mkdir -m 700 "$secret_dir"
  printf '%s' "$GOOGLE_CLIENT_ID" > "$secret_dir/GOOGLE_CLIENT_ID"
  printf '%s' "$GOOGLE_CLIENT_SECRET" > "$secret_dir/GOOGLE_CLIENT_SECRET"
  printf '%s' "$NEXTAUTH_SECRET" > "$secret_dir/NEXTAUTH_SECRET"
  printf 'https://%s' "$APP_HOSTNAME" > "$secret_dir/NEXTAUTH_URL"
  chmod 600 "$secret_dir"/*

  kubectl --namespace "$NAMESPACE" create secret generic "$APP_SECRET" \
    --from-file="$secret_dir/GOOGLE_CLIENT_ID" \
    --from-file="$secret_dir/GOOGLE_CLIENT_SECRET" \
    --from-file="$secret_dir/NEXTAUTH_SECRET" \
    --from-file="$secret_dir/NEXTAUTH_URL" \
    --dry-run=client \
    --output=yaml |
    kubectl apply --filename=- >/dev/null
}

run_job() {
  local job_name="$1"
  local manifest="$2"

  kubectl --namespace "$NAMESPACE" delete job "$job_name" --ignore-not-found --wait=true >/dev/null
  kubectl apply --filename="$manifest" >/dev/null
  if ! kubectl --namespace "$NAMESPACE" wait \
    --for=condition=complete \
    "job/${job_name}" \
    --timeout=11m; then
    kubectl --namespace "$NAMESPACE" logs "job/${job_name}" --all-containers=true || true
    kubectl --namespace "$NAMESPACE" describe "job/${job_name}" || true
    return 1
  fi
  kubectl --namespace "$NAMESPACE" logs "job/${job_name}" --all-containers=true
  kubectl --namespace "$NAMESPACE" delete job "$job_name" --wait=true >/dev/null
}

create_app_secret

migration_job="grocery-migrate-${RELEASE_ID}"
render_component deploy/k8s/migration "$work_dir/migration" "-${RELEASE_ID}"
run_job "$migration_job" "$work_dir/migration/rendered.yaml"

if kubectl --namespace "$NAMESPACE" get configmap "$BOOTSTRAP_MARKER" >/dev/null 2>&1; then
  echo "Production database bootstrap marker exists; skipping initialization."
else
  if [[ -z "${INITIAL_ADMIN_EMAIL:-}" || -z "${INITIAL_HOUSEHOLD_NAME:-}" ]]; then
    echo "Initial deployment requires INITIAL_ADMIN_EMAIL and INITIAL_HOUSEHOLD_NAME." >&2
    exit 1
  fi

  bootstrap_dir="$work_dir/bootstrap-secret"
  mkdir -m 700 "$bootstrap_dir"
  printf '%s' "$INITIAL_ADMIN_EMAIL" > "$bootstrap_dir/INITIAL_ADMIN_EMAIL"
  printf '%s' "$INITIAL_HOUSEHOLD_NAME" > "$bootstrap_dir/INITIAL_HOUSEHOLD_NAME"
  chmod 600 "$bootstrap_dir"/*
  kubectl --namespace "$NAMESPACE" create secret generic "$BOOTSTRAP_SECRET" \
    --from-file="$bootstrap_dir/INITIAL_ADMIN_EMAIL" \
    --from-file="$bootstrap_dir/INITIAL_HOUSEHOLD_NAME" \
    --dry-run=client \
    --output=yaml |
    kubectl apply --filename=- >/dev/null
  bootstrap_secret_created=true

  bootstrap_job="grocery-bootstrap-${RELEASE_ID}"
  render_component deploy/k8s/bootstrap "$work_dir/bootstrap" "-${RELEASE_ID}"
  run_job "$bootstrap_job" "$work_dir/bootstrap/rendered.yaml"

  kubectl --namespace "$NAMESPACE" create configmap "$BOOTSTRAP_MARKER" \
    --from-literal="initialized-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --from-literal="release-digest=${IMAGE_REFERENCE#*@}" \
    --dry-run=client \
    --output=yaml |
    kubectl apply --filename=- >/dev/null
  kubectl --namespace "$NAMESPACE" delete secret "$BOOTSTRAP_SECRET" --ignore-not-found >/dev/null
  bootstrap_secret_created=false
  echo "Production household initialization completed."
fi

previous_image="$(
  kubectl --namespace "$NAMESPACE" get deployment grocery-app \
    --output=jsonpath='{.spec.template.spec.containers[?(@.name=="grocery-app")].image}' \
    2>/dev/null || true
)"

render_component deploy/k8s/application "$work_dir/application"
kubectl apply --filename="$work_dir/application/rendered.yaml" >/dev/null

rollback() {
  if [[ -z "$previous_image" || "$previous_image" == "$IMAGE_REFERENCE" ]]; then
    echo "No previous application image is available for rollback." >&2
    return
  fi
  echo "Restoring previous application image ${previous_image}." >&2
  kubectl --namespace "$NAMESPACE" set image deployment/grocery-app "grocery-app=${previous_image}" >/dev/null
  kubectl --namespace "$NAMESPACE" rollout status deployment/grocery-app --timeout=10m || true
}

if ! kubectl --namespace "$NAMESPACE" rollout status deployment/grocery-app --timeout=10m; then
  kubectl --namespace "$NAMESPACE" get pods --selector=app.kubernetes.io/name=grocery-app --output=wide || true
  kubectl --namespace "$NAMESPACE" describe deployment grocery-app || true
  kubectl --namespace "$NAMESPACE" logs deployment/grocery-app --all-containers=true --tail=200 || true
  rollback
  exit 1
fi

if ! curl --fail --silent --show-error \
  --retry 12 \
  --retry-all-errors \
  --retry-delay 5 \
  "https://${APP_HOSTNAME}/api/health/ready" >/dev/null; then
  echo "Production readiness smoke test failed." >&2
  rollback
  exit 1
fi

echo "Application deployment and readiness smoke test passed."
