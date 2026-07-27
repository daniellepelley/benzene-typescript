terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

locals {
  bucket_name = var.artifact_bucket_name != "" ? var.artifact_bucket_name : "${var.project}-${data.aws_caller_identity.current.account_id}"

  # The six Cloud Service Lambdas. Each is tagged so discovery finds it. orders/payments/shipping form
  # the command chain and publish events; inventory/notifications/analytics are pure event consumers.
  services = {
    orders        = { zip = var.orders_zip, name = "${var.project}-orders" }
    payments      = { zip = var.payments_zip, name = "${var.project}-payments" }
    shipping      = { zip = var.shipping_zip, name = "${var.project}-shipping" }
    inventory     = { zip = var.inventory_zip, name = "${var.project}-inventory" }
    notifications = { zip = var.notifications_zip, name = "${var.project}-notifications" }
    analytics     = { zip = var.analytics_zip, name = "${var.project}-analytics" }
  }

  # Per-service outbound targets, handed to each producer as env vars (consumers just receive). The TS
  # `functions/shared.ts` reads exactly these names (from each send's `targetEnvVar`). A stable
  # MESH_SERVICE var is always present so every function's environment block is non-empty and its shape
  # never changes across applies (avoids the AWS provider's "block count changed 0->1" plan bug when a
  # value like an SQS queue URL is only known after apply).
  service_env = {
    orders        = { PAYMENTS_QUEUE_URL = aws_sqs_queue.payments.url, ORDER_PLACED_TOPIC_ARN = aws_sns_topic.order_placed.arn }
    payments      = { SHIPPING_QUEUE_URL = aws_sqs_queue.shipping.url, EVENT_BUS_NAME = aws_cloudwatch_event_bus.bus.name }
    shipping      = { EVENT_BUS_NAME = aws_cloudwatch_event_bus.bus.name }
    inventory     = {}
    notifications = {}
    analytics     = {}
  }

  # SNS fan-out: order:placed is delivered to each of these service Lambdas.
  sns_order_placed_subscribers = toset(["inventory", "notifications"])

  # EventBridge routing: one rule per integration event (matched on detail-type = the Benzene topic),
  # fanned out to the listed consumer Lambdas. Rule keys are slugs (no ':') for valid resource names.
  # The TS EventBridge outbound client sets DetailType = the topic, so route on that.
  eventbridge_rules = {
    payment_captured    = { detail_type = "payment:captured", targets = ["notifications", "analytics"] }
    shipment_dispatched = { detail_type = "shipment:dispatched", targets = ["inventory", "notifications", "analytics"] }
  }

  # Flatten {rule -> [targets]} to individual (rule, service) pairs for the per-target resources.
  eventbridge_targets = merge([
    for rule_key, rule in local.eventbridge_rules : {
      for svc in rule.targets : "${rule_key}-${svc}" => { rule_key = rule_key, service = svc }
    }
  ]...)
}

# ---------------------------------------------------------------------------------------------------
# S3 bucket for the discovered registry + generated catalog artifacts (written by the mesh Lambda).
# ---------------------------------------------------------------------------------------------------
resource "aws_s3_bucket" "artifacts" {
  bucket        = local.bucket_name
  force_destroy = true
}

# ---------------------------------------------------------------------------------------------------
# Static catalog viewer: the mesh writes its catalog (manifest/topics/topology.json) under mesh/, and a
# single self-contained web/index.html reads them with same-origin relative fetches. Serve it as an S3
# static website so `http://<endpoint>/mesh/` resolves to mesh/index.html and its ./manifest.json etc.
# resolve to the catalog next to it. This is the lightweight, language-neutral stand-in for the .NET
# mesh's Lambda-served UI. NOTE: this makes the catalog under mesh/ publicly readable (demo default) —
# the catalog is non-sensitive service metadata; drop the public-read policy to keep it private.
# ---------------------------------------------------------------------------------------------------
resource "aws_s3_bucket_website_configuration" "viewer" {
  bucket = aws_s3_bucket.artifacts.id
  index_document {
    suffix = "index.html"
  }
}

resource "aws_s3_bucket_public_access_block" "viewer" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# Public read for the viewer + the catalog it reads (everything under mesh/).
data "aws_iam_policy_document" "viewer_public_read" {
  statement {
    sid       = "PublicReadMeshCatalog"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/mesh/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "viewer" {
  bucket     = aws_s3_bucket.artifacts.id
  policy     = data.aws_iam_policy_document.viewer_public_read.json
  depends_on = [aws_s3_bucket_public_access_block.viewer]
}

# The viewer page itself, uploaded next to the catalog the mesh writes (mesh/index.html). Re-uploaded
# whenever the file changes (etag). Independent of the mesh's own artifact writes — different key.
resource "aws_s3_object" "viewer" {
  bucket       = aws_s3_bucket.artifacts.id
  key          = "mesh/index.html"
  source       = var.viewer_html
  etag         = filemd5(var.viewer_html)
  content_type = "text/html"
}

# ---------------------------------------------------------------------------------------------------
# IAM: a shared execution+messaging role for the service Lambdas, and a discover+invoke+S3 role for the
# mesh. Node bundles are tiny (~60 KB), so code is deployed inline (filename) rather than via S3 — no
# RequestEntityTooLarge concern like the .NET self-contained publishes have.
# ---------------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "service" {
  name               = "${var.project}-service-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "service_logs" {
  role       = aws_iam_role.service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role" "mesh" {
  name               = "${var.project}-mesh-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "mesh_logs" {
  role       = aws_iam_role.mesh.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "mesh" {
  # Discover: list all functions and read their tags.
  statement {
    actions   = ["lambda:ListFunctions", "lambda:ListTags"]
    resources = ["*"]
  }
  # Interrogate: invoke the discovered service functions.
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [for s in local.services : "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:${s.name}"]
  }
  # Persist the registry + catalog artifacts.
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
  }
}

resource "aws_iam_role_policy" "mesh" {
  name   = "${var.project}-mesh-policy"
  role   = aws_iam_role.mesh.id
  policy = data.aws_iam_policy_document.mesh.json
}

# The shared service role's producer permissions: send to both queues (and consume them — the
# event-source mapping polls with the function's role), publish the SNS topic, and put events on the bus.
data "aws_iam_policy_document" "service_messaging" {
  statement {
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.payments.arn, aws_sqs_queue.shipping.arn]
  }
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.order_placed.arn]
  }
  statement {
    actions   = ["events:PutEvents"]
    resources = [aws_cloudwatch_event_bus.bus.arn]
  }
}

resource "aws_iam_role_policy" "service_messaging" {
  name   = "${var.project}-service-messaging"
  role   = aws_iam_role.service.id
  policy = data.aws_iam_policy_document.service_messaging.json
}

# ---------------------------------------------------------------------------------------------------
# The six Cloud Service Lambdas (tagged for discovery) + one HTTP API each.
# ---------------------------------------------------------------------------------------------------
resource "aws_lambda_function" "service" {
  for_each = local.services

  function_name    = each.value.name
  role             = aws_iam_role.service.arn
  filename         = each.value.zip
  source_code_hash = filebase64sha256(each.value.zip)
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  architectures    = [var.lambda_architecture]
  memory_size      = 256
  timeout          = 30

  environment {
    variables = merge({ MESH_SERVICE = each.key }, local.service_env[each.key])
  }

  # Discovery finds services by this tag; the mesh Lambda deliberately does NOT carry it.
  tags = { (var.discovery_tag_key) = "true" }
}

# ---------------------------------------------------------------------------------------------------
# Runtime interconnectivity — each transport used for what it's good at:
#   • SQS (point-to-point commands): orders → payments (payments:capture), payments → shipping
#     (shipping:book). Each queue triggers its service Lambda (event-source mapping).
#   • SNS (fan-out event): orders publishes order:placed → inventory AND notifications (subscriptions).
#   • EventBridge (routed integration events on a custom bus): payments publishes payment:captured,
#     shipping publishes shipment:dispatched → routed by rule to notifications/inventory/analytics.
# ---------------------------------------------------------------------------------------------------

# --- SQS: the point-to-point command hops -----------------------------------------------------------
resource "aws_sqs_queue" "payments" {
  name                       = "${var.project}-payments-queue"
  visibility_timeout_seconds = 60
}

resource "aws_sqs_queue" "shipping" {
  name                       = "${var.project}-shipping-queue"
  visibility_timeout_seconds = 60
}

resource "aws_lambda_event_source_mapping" "payments" {
  event_source_arn = aws_sqs_queue.payments.arn
  function_name    = aws_lambda_function.service["payments"].arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "shipping" {
  event_source_arn = aws_sqs_queue.shipping.arn
  function_name    = aws_lambda_function.service["shipping"].arn
  batch_size       = 1
}

# --- SNS: the order:placed fan-out ------------------------------------------------------------------
resource "aws_sns_topic" "order_placed" {
  name = "${var.project}-order-placed"
}

resource "aws_sns_topic_subscription" "order_placed" {
  for_each  = local.sns_order_placed_subscribers
  topic_arn = aws_sns_topic.order_placed.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.service[each.key].arn
}

resource "aws_lambda_permission" "sns_invoke" {
  for_each      = local.sns_order_placed_subscribers
  statement_id  = "AllowSnsInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.service[each.key].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.order_placed.arn
}

# --- EventBridge: the routed integration events on a dedicated bus -----------------------------------
resource "aws_cloudwatch_event_bus" "bus" {
  name = "${var.project}-bus"
}

resource "aws_cloudwatch_event_rule" "integration" {
  for_each       = local.eventbridge_rules
  name           = "${var.project}-${each.key}"
  event_bus_name = aws_cloudwatch_event_bus.bus.name
  event_pattern  = jsonencode({ "detail-type" = [each.value.detail_type] })
}

resource "aws_cloudwatch_event_target" "integration" {
  for_each       = local.eventbridge_targets
  rule           = aws_cloudwatch_event_rule.integration[each.value.rule_key].name
  event_bus_name = aws_cloudwatch_event_bus.bus.name
  target_id      = each.value.service
  arn            = aws_lambda_function.service[each.value.service].arn
}

resource "aws_lambda_permission" "eventbridge_invoke" {
  for_each      = local.eventbridge_targets
  statement_id  = "AllowEventBridge-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.service[each.value.service].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.integration[each.value.rule_key].arn
}

# ---------------------------------------------------------------------------------------------------
# One HTTP API per service: a $default catch-all proxies the full path through. The meaningful route is
# orders' POST /orders (kicks off the cascade); the others expose each service's HTTP domain surface.
# ---------------------------------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "service" {
  for_each      = local.services
  name          = "${each.value.name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "service" {
  for_each               = local.services
  api_id                 = aws_apigatewayv2_api.service[each.key].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.service[each.key].invoke_arn
  payload_format_version = "1.0" # matches what @benzene/aws-lambda-api-gateway parses (APIGatewayProxyEvent v1)
}

resource "aws_apigatewayv2_route" "service" {
  for_each  = local.services
  api_id    = aws_apigatewayv2_api.service[each.key].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.service[each.key].id}"
}

resource "aws_apigatewayv2_stage" "service" {
  for_each    = local.services
  api_id      = aws_apigatewayv2_api.service[each.key].id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "service_api" {
  for_each      = local.services
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.service[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.service[each.key].execution_arn}/*/*"
}

# ---------------------------------------------------------------------------------------------------
# The mesh Lambda (NOT tagged for discovery) + the aggregation schedule. It has no HTTP API: its
# handler returns a plain summary object (discover → aggregate to S3), not an API-Gateway proxy
# response, so it's driven purely by the EventBridge schedule. Read its output from the S3 bucket.
# ---------------------------------------------------------------------------------------------------
resource "aws_lambda_function" "mesh" {
  function_name    = "${var.project}-mesh"
  role             = aws_iam_role.mesh.arn
  filename         = var.mesh_zip
  source_code_hash = filebase64sha256(var.mesh_zip)
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  architectures    = [var.lambda_architecture]
  memory_size      = 256
  timeout          = 60

  environment {
    variables = {
      MESH_ARTIFACT_BUCKET = aws_s3_bucket.artifacts.id
      MESH_ARTIFACT_PREFIX = "mesh"
    }
  }
}

# Scheduled aggregation: fire the mesh Lambda on a schedule with a constant payload (the mesh handler
# ignores the event and always runs the discover → aggregate pass).
resource "aws_cloudwatch_event_rule" "aggregate" {
  name                = "${var.project}-aggregate"
  schedule_expression = var.aggregate_schedule
}

resource "aws_cloudwatch_event_target" "aggregate" {
  rule      = aws_cloudwatch_event_rule.aggregate.name
  target_id = "mesh"
  arn       = aws_lambda_function.mesh.arn
  input     = jsonencode({ "detail-type" = "mesh:aggregate", "source" = "benzene.mesh", "detail" = "{}" })
}

resource "aws_lambda_permission" "mesh_events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mesh.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.aggregate.arn
}
