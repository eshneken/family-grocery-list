resource "terraform_data" "caddy_load_balancer_name" {
  # CCM owns the load balancer lifecycle. Reconcile only its OCI display name
  # after the Service has exposed the reserved public IP.
  input = {
    compartment_id = var.compartment_ocid
    public_ip      = data.terraform_remote_state.production.outputs.reserved_public_ip
    display_name   = var.load_balancer_display_name
  }

  triggers_replace = [
    kubernetes_service_v1.caddy.metadata[0].uid,
    data.terraform_remote_state.production.outputs.reserved_public_ip,
    var.load_balancer_display_name,
  ]

  provisioner "local-exec" {
    interpreter = ["/usr/bin/env", "bash", "-c"]
    command     = <<-EOT
      set -euo pipefail

      load_balancer_id="$(oci lb load-balancer list \
        --compartment-id "$COMPARTMENT_ID" \
        --all \
        --query "data[?contains(\"ip-addresses\"[].\"ip-address\", '$LOAD_BALANCER_IP')].id | [0]" \
        --raw-output)"

      if [[ -z "$load_balancer_id" || "$load_balancer_id" == "null" ]]; then
        echo "No OCI load balancer is attached to $LOAD_BALANCER_IP yet." >&2
        exit 1
      fi

      oci lb load-balancer update \
        --load-balancer-id "$load_balancer_id" \
        --display-name "$LOAD_BALANCER_NAME" \
        --force \
        --wait-for-state SUCCEEDED
    EOT

    environment = {
      COMPARTMENT_ID     = var.compartment_ocid
      LOAD_BALANCER_IP   = data.terraform_remote_state.production.outputs.reserved_public_ip
      LOAD_BALANCER_NAME = var.load_balancer_display_name
    }
  }

  # CCM can leave a load balancer behind after the Kubernetes Service is
  # removed. Delete it while the Terraform-managed reserved IP is still known.
  provisioner "local-exec" {
    when        = destroy
    interpreter = ["/usr/bin/env", "bash", "-c"]
    command     = <<-EOT
      set -euo pipefail

      load_balancer_id="$(oci lb load-balancer list \
        --compartment-id "$COMPARTMENT_ID" \
        --all \
        --query "data[?contains(\"ip-addresses\"[].\"ip-address\", '$LOAD_BALANCER_IP')].id | [0]" \
        --raw-output)"

      if [[ -z "$load_balancer_id" || "$load_balancer_id" == "null" ]]; then
        exit 0
      fi

      oci lb load-balancer delete \
        --load-balancer-id "$load_balancer_id" \
        --force \
        --wait-for-state SUCCEEDED
    EOT

    environment = {
      COMPARTMENT_ID   = self.input.compartment_id
      LOAD_BALANCER_IP = self.input.public_ip
    }
  }

  depends_on = [kubernetes_service_v1.caddy]
}
