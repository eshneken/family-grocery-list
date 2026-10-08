#!/usr/bin/env bash
# Isolated target-bound working copies: never consume legacy ignored tfvars/state.
set -euo pipefail
stage="${1:?stage: tenancy-identity, bootstrap, production or cluster-foundation}"
operation="${2:-plan}"
case "$stage" in tenancy-identity|bootstrap|production|cluster-foundation) ;; *) exit 2 ;; esac
case "$operation" in plan|apply) ;; *) exit 2 ;; esac
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
target_exports="$(python3 "$repo_dir/scripts/oci_target.py" --shell)"
eval "$target_exports"
profile="${OCI_CLI_PROFILE:-$OCI_OPERATOR_PROFILE}"
auth="${TF_VAR_oci_auth:-ApiKey}"
export TF_VAR_oci_config_profile="$profile"
export TF_VAR_oci_auth="$auth"
namespace="$(oci os ns get --profile "$profile" --auth "${OCI_CLI_AUTH:-api_key}" --query data --raw-output)"
[[ "$namespace" == "$OCI_OBJECT_NAMESPACE" ]] || { echo 'OCI authenticated to the wrong tenancy.' >&2; exit 1; }
if [[ "$operation" == apply && "${CONFIRM_APPLY_SHA:-}" != "$(git -C "$repo_dir" rev-parse HEAD)" ]]; then
  echo 'Review the plan, then set CONFIRM_APPLY_SHA to the full reviewed commit SHA.' >&2
  exit 1
fi
if [[ "$operation" == apply && -n "$(git -C "$repo_dir" status --porcelain)" ]]; then
  echo 'Apply requires a clean migration checkout at the reviewed commit.' >&2
  exit 1
fi
umask 077
work_dir="${ALWAYS_FREE_WORK_DIR:-$repo_dir/.always-free/terraform}/$stage"
mkdir -p "$work_dir"
# Remove only staged source definitions, preserving private plans/backend state.
for staged in "$work_dir/"*.tf; do [[ ! -f "$staged" ]] || rm "$staged"; done
# Copy source only, never .terraform, old backend config, tfvars or state.
for source in "$repo_dir/infra/$stage/"*.tf; do cp "$source" "$work_dir/"; done
if [[ -f "$repo_dir/infra/$stage/.terraform.lock.hcl" ]]; then
  cp "$repo_dir/infra/$stage/.terraform.lock.hcl" "$work_dir/"
fi
if [[ "$stage" == tenancy-identity ]]; then
  [[ "$profile" == "$OCI_OPERATOR_PROFILE" ]] || { echo 'Tenancy prerequisites require the local administrator profile.' >&2; exit 1; }
  # Before bootstrap this prerequisite root must use local state. Once the
  # bucket exists, migrate it to a separate remote key using the administrator.
  if [[ -f "$work_dir/remote-backend-ready" ]] || oci os bucket get --profile "$profile" --namespace-name "$namespace" --bucket-name "$TF_VAR_state_bucket_name" >/dev/null 2>&1; then
    printf 'terraform {\n  backend "oci" {}\n}\n' > "$work_dir/backend.tf"
  else
    printf 'terraform {\n  backend "local" {}\n}\n' > "$work_dir/backend.tf"
  fi
elif [[ "$stage" == bootstrap && ! -f "$work_dir/remote-backend-ready" ]]; then
  # Initial bootstrap state lives only in this private operator working directory.
  # If the bucket already exists, require an existing bootstrap state to avoid duplication.
  if oci os bucket get --profile "$profile" --namespace-name "$namespace" --bucket-name "$TF_VAR_state_bucket_name" >/dev/null 2>&1; then
    oci os object head --profile "$profile" --namespace-name "$namespace" --bucket-name "$TF_VAR_state_bucket_name" --name bootstrap/terraform.tfstate >/dev/null
    printf 'terraform {\n  backend "oci" {}\n}\n' > "$work_dir/backend.tf"
    touch "$work_dir/remote-backend-ready"
  else
    printf 'terraform {\n  backend "local" {}\n}\n' > "$work_dir/backend.tf"
  fi
else
  printf 'terraform {\n  backend "oci" {}\n}\n' > "$work_dir/backend.tf"
fi
backend_args=(-input=false)
if grep -q 'backend "oci"' "$work_dir/backend.tf"; then
  backend_args=(-input=false -backend-config="bucket=$TF_VAR_state_bucket_name" -backend-config="namespace=$namespace" -backend-config="key=$stage/terraform.tfstate" -backend-config="region=us-ashburn-1" -backend-config="auth=$auth" -backend-config="config_file_profile=$profile")
  if [[ "$stage" == tenancy-identity && -f "$work_dir/terraform.tfstate" && ! -f "$work_dir/remote-backend-ready" ]]; then
    backend_args+=(-migrate-state -force-copy)
  fi
fi
terraform -chdir="$work_dir" init "${backend_args[@]}"
if grep -q 'backend "oci"' "$work_dir/backend.tf"; then touch "$work_dir/remote-backend-ready"; fi
vars_args=(-input=false)
if [[ -n "${ALWAYS_FREE_VARS_FILE:-}" ]]; then vars_args=(-input=false -var-file="$ALWAYS_FREE_VARS_FILE"); fi
terraform -chdir="$work_dir" plan "${vars_args[@]}" -out=reviewed.tfplan
terraform -chdir="$work_dir" show -json reviewed.tfplan | python3 "$repo_dir/scripts/check-always-free-plan.py"
if [[ "$operation" == apply ]]; then
  terraform -chdir="$work_dir" apply -input=false reviewed.tfplan
  if [[ "$stage" == bootstrap && ! -f "$work_dir/remote-backend-ready" ]]; then
    printf 'terraform {\n  backend "oci" {}\n}\n' > "$work_dir/backend.tf"
    terraform -chdir="$work_dir" init -migrate-state -force-copy -input=false \
      -backend-config="bucket=$TF_VAR_state_bucket_name" -backend-config="namespace=$namespace" \
      -backend-config="key=bootstrap/terraform.tfstate" -backend-config="region=us-ashburn-1" \
      -backend-config="auth=$auth" -backend-config="config_file_profile=$profile"
    touch "$work_dir/remote-backend-ready"
  fi
fi
