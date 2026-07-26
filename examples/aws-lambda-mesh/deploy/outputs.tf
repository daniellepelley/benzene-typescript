output "orders_url" {
  description = "POST an order here to kick off the cascade, e.g. curl -X POST <this>/orders -d '{\"orderId\":\"o1\"}'."
  value       = "${aws_apigatewayv2_api.service["orders"].api_endpoint}/orders"
}

output "service_api_endpoints" {
  description = "Each service's HTTP API root."
  value       = { for k, api in aws_apigatewayv2_api.service : k => api.api_endpoint }
}

output "artifact_bucket" {
  description = "The S3 bucket holding the discovered registry.json and the generated catalog artifacts (manifest.json, services/*.json, topics.json, topology.json). The mesh Lambda writes them under the 'mesh/' prefix."
  value       = aws_s3_bucket.artifacts.id
}

output "mesh_function_name" {
  description = "The mesh Lambda. Invoke it directly to run an aggregation pass on demand: aws lambda invoke --function-name <this> /dev/stdout."
  value       = aws_lambda_function.mesh.function_name
}

output "catalog_manifest_uri" {
  description = "The S3 URI of the catalog manifest the mesh writes each pass (read with: aws s3 cp <this> -)."
  value       = "s3://${aws_s3_bucket.artifacts.id}/mesh/manifest.json"
}
