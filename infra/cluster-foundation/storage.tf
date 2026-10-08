resource "kubernetes_storage_class_v1" "platform" {
  metadata { name = "grocery-retained-bv" }
  storage_provisioner    = "blockvolume.csi.oraclecloud.com"
  reclaim_policy         = "Retain"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = false
  parameters             = { vpusPerGB = "10", "attachment-type" = "paravirtualized" }
}
resource "kubernetes_persistent_volume_claim_v1" "platform" {
  metadata {
    name      = "platform-data"
    namespace = var.namespace
  }
  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = kubernetes_storage_class_v1.platform.metadata[0].name
    resources { requests = { storage = "50Gi" } }
  }
  wait_until_bound = false
  lifecycle { prevent_destroy = true }
  depends_on = [kubernetes_namespace_v1.grocery]
}
