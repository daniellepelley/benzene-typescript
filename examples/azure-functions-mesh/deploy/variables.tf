variable "location" {
  description = "Azure region to deploy into."
  type        = string
  default     = "westeurope"
}

variable "node_version" {
  description = "The Node.js version pinned on the Functions host stack (linuxFxVersion). Each Function App's code is bundled ESM (esbuild), so this only needs to be a Node major version the Functions host supports."
  type        = string
  default     = "20"
}

variable "project" {
  description = "Name prefix for all resources (must yield globally-unique Function App names)."
  type        = string
  default     = "benzene-ts-fnmesh"
}

variable "resource_group" {
  description = "Resource group name."
  type        = string
  default     = "benzene-ts-fnmesh-rg"
}

variable "storage_account" {
  description = "Storage account for the Functions runtime + the mesh catalog artifacts (globally unique, lowercase alphanumeric)."
  type        = string
}

variable "discovery_tag_key" {
  description = "The resource tag key discovery filters on. Services carry it; the mesh does not."
  type        = string
  default     = "benzene"
}

variable "wire_eventgrid_subscriptions" {
  description = <<-EOT
    Whether to create the Event Grid -> Function subscriptions. They point at each consumer's Functions
    Event Grid extension webhook, which is validated against the live running function, so the target
    must be published AND warm. The deploy therefore does one apply with this false (everything except
    the subscriptions), publishes the code, warms the consumer apps, then a second apply with this true —
    mirroring .NET's AzureFunctionsMesh deploy exactly (see that example's README for why).
  EOT
  type        = bool
  default     = false
}
