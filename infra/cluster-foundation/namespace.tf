resource "kubernetes_namespace_v1" "grocery" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/part-of" = "family-grocery-list"
    }
  }
}
