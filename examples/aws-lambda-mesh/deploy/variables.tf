variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "eu-west-1"
}

variable "project" {
  description = "Name prefix for all resources."
  type        = string
  default     = "benzene-ts-mesh"
}

variable "artifact_bucket_name" {
  description = "S3 bucket for the mesh registry + catalog artifacts. Must be globally unique; defaults to <project>-<account-id>."
  type        = string
  default     = ""
}

variable "discovery_tag_key" {
  description = "The resource tag key discovery filters on. Services carry this tag; the mesh Lambda does not (so it never discovers itself)."
  type        = string
  default     = "benzene"
}

variable "lambda_architecture" {
  description = "Lambda architecture (x86_64 or arm64). The Node bundle is platform-neutral JS, so either works without a rebuild."
  type        = string
  default     = "x86_64"
}

variable "aggregate_schedule" {
  description = "EventBridge schedule expression for the mesh aggregation pass. Defaults to every minute so the catalog stays fresh. Raise it (e.g. rate(5 minutes)) to cut invocations if you don't need near-live data."
  type        = string
  default     = "rate(1 minute)"
}

# Paths to the built Lambda zips (each a single index.mjs exporting `handler`). Produced by
# `npm run bundle` (esbuild), which writes them to ../artifacts. Defaults assume that layout.
variable "orders_zip" {
  type    = string
  default = "../artifacts/orders.zip"
}
variable "payments_zip" {
  type    = string
  default = "../artifacts/payments.zip"
}
variable "shipping_zip" {
  type    = string
  default = "../artifacts/shipping.zip"
}
variable "inventory_zip" {
  type    = string
  default = "../artifacts/inventory.zip"
}
variable "notifications_zip" {
  type    = string
  default = "../artifacts/notifications.zip"
}
variable "analytics_zip" {
  type    = string
  default = "../artifacts/analytics.zip"
}
variable "mesh_zip" {
  type    = string
  default = "../artifacts/mesh.zip"
}

variable "viewer_html" {
  description = "Path to the static catalog viewer page, served from S3 at <website>/mesh/."
  type        = string
  default     = "../web/index.html"
}
