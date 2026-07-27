#!/usr/bin/env bash
# Idempotently adopt already-existing AWS resources into Terraform state.
#
# Why this exists: with remote state now configured, a fresh (empty) state would still collide with any
# resources a previous run created (409 AlreadyExists). This script imports each one *if* it exists in AWS
# and is *not* already tracked in state, so it is safe to run on every deploy:
#   - clean account  -> discovery finds nothing, every import is skipped, apply creates everything.
#   - after adoption -> resources are in state, every import is skipped, apply updates in place.
#
# Adapted from .NET's examples/AwsMesh/deploy/adopt-existing.sh to this TypeScript stack's resource set
# (no S3 code objects — code is inline; a shared service-messaging policy; no mesh HTTP API; the mesh is
# driven only by the EventBridge schedule).
#
# Requires: terraform (initialised with the remote backend) + awscli, run from the deploy/ dir.
set -euo pipefail

PROJECT="${PROJECT:-benzene-ts-mesh}"
REGION="${REGION:-eu-west-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BASIC_EXEC="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

# Cache the current state addresses once (empty on first run).
STATE_ADDRS="$(terraform state list 2>/dev/null || true)"

tf_import() {
  local addr="$1" id="$2"
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    echo "· skip (not in AWS): $addr"
    return 0
  fi
  if printf '%s\n' "$STATE_ADDRS" | grep -qxF "$addr"; then
    echo "· already in state: $addr"
    return 0
  fi
  echo "· import: $addr  <-  $id"
  # A deterministic-id resource that doesn't exist in AWS yet isn't an error — apply will create it.
  # Terraform words this differently per resource type: most say "Cannot import non-existent remote
  # object", but a missing aws_lambda_permission (its function not created yet) fails with "couldn't
  # find resource". Swallow both as "not in AWS yet".
  local out
  if out="$(terraform import -input=false -var "region=$REGION" "$addr" "$id" 2>&1)"; then
    printf '%s\n' "$out"
    return 0
  fi
  if printf '%s\n' "$out" | grep -qE "Cannot import non-existent remote object|[Cc]ouldn't find resource"; then
    echo "· skip (not in AWS yet — apply will create it): $addr"
    return 0
  fi
  printf '%s\n' "$out" >&2
  return 1
}

# All HTTP API ids with a given name (a failed run can leave duplicate names).
api_ids() {
  aws apigatewayv2 get-apis --region "$REGION" \
    --query "Items[?Name=='$1'].ApiId" --output text 2>/dev/null || true
}

first_integration() {
  aws apigatewayv2 get-integrations --api-id "$1" --region "$REGION" \
    --query 'Items[0].IntegrationId' --output text 2>/dev/null || true
}

# Pick the *complete* api for a name — the one that actually has an integration — so we never adopt a
# half-created duplicate. Falls back to the first id, or empty if the name doesn't exist at all.
pick_complete_api() {
  local first=""
  for id in $(api_ids "$1"); do
    [ -z "$id" ] && continue
    [ -z "$first" ] && first="$id"
    local int; int="$(first_integration "$id")"
    if [ -n "$int" ] && [ "$int" != "None" ]; then
      echo "$id"
      return 0
    fi
  done
  echo "$first"
}

# ---- S3 + IAM (deterministic ids) ----------------------------------------------------------------
tf_import 'aws_s3_bucket.artifacts' "${PROJECT}-${ACCOUNT}"
tf_import 'aws_iam_role.service' "${PROJECT}-service-role"
tf_import 'aws_iam_role.mesh' "${PROJECT}-mesh-role"
tf_import 'aws_iam_role_policy_attachment.service_logs' "${PROJECT}-service-role/${BASIC_EXEC}"
tf_import 'aws_iam_role_policy_attachment.mesh_logs' "${PROJECT}-mesh-role/${BASIC_EXEC}"
tf_import 'aws_iam_role_policy.mesh' "${PROJECT}-mesh-role:${PROJECT}-mesh-policy"
tf_import 'aws_iam_role_policy.service_messaging' "${PROJECT}-service-role:${PROJECT}-service-messaging"

# ---- Lambda functions + permissions --------------------------------------------------------------
for svc in orders payments shipping inventory notifications analytics; do
  tf_import "aws_lambda_function.service[\"$svc\"]" "${PROJECT}-${svc}"
  tf_import "aws_lambda_permission.service_api[\"$svc\"]" "${PROJECT}-${svc}/AllowApiGatewayInvoke"
done
tf_import 'aws_lambda_function.mesh' "${PROJECT}-mesh"
tf_import 'aws_lambda_permission.mesh_events' "${PROJECT}-mesh/AllowEventBridgeInvoke"

# ---- API Gateway (opaque ids — discover by name) -------------------------------------------------
adopt_http_api() {
  local addr_key="$1" api_name="$2"
  local id; id="$(pick_complete_api "$api_name")"
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    echo "· skip (no API named $api_name)"
    return 0
  fi
  tf_import "aws_apigatewayv2_api.${addr_key}" "$id"

  local int_id; int_id="$(first_integration "$id")"
  [ "$int_id" = "None" ] && int_id=""
  if [ -n "$int_id" ]; then
    tf_import "aws_apigatewayv2_integration.${addr_key}" "$id/$int_id"
  else
    echo "· skip integration (none on $id — apply will create it)"
  fi

  local route_id; route_id="$(aws apigatewayv2 get-routes --api-id "$id" --region "$REGION" \
    --query "Items[?RouteKey=='\$default'].RouteId | [0]" --output text 2>/dev/null || true)"
  [ "$route_id" = "None" ] && route_id=""
  if [ -n "$route_id" ]; then
    tf_import "aws_apigatewayv2_route.${addr_key}" "$id/$route_id"
  else
    echo "· skip route (none on $id — apply will create it)"
  fi

  local stage; stage="$(aws apigatewayv2 get-stages --api-id "$id" --region "$REGION" \
    --query "Items[?StageName=='\$default'].StageName | [0]" --output text 2>/dev/null || true)"
  if [ -n "$stage" ] && [ "$stage" != "None" ]; then
    tf_import "aws_apigatewayv2_stage.${addr_key}" "$id/\$default"
  else
    echo "· skip stage (no \$default stage on $id — apply will create it)"
  fi
}

for svc in orders payments shipping inventory notifications analytics; do
  adopt_http_api "service[\"$svc\"]" "${PROJECT}-${svc}-api"
done

# ---- EventBridge schedule (default bus) ----------------------------------------------------------
tf_import 'aws_cloudwatch_event_rule.aggregate' "default/${PROJECT}-aggregate"
tf_import 'aws_cloudwatch_event_target.aggregate' "default/${PROJECT}-aggregate/mesh"

# ---- Inter-service messaging: SNS fan-out + EventBridge integration events -----------------------
# CreateTopic/PutRule/PutTargets/Subscribe are upserts (no 409), but CreateFunction, AddPermission and
# CreateEventBus DO collide, so those are the ones that must be adopted after a state loss.
tf_import 'aws_sns_topic.order_placed' "arn:aws:sns:${REGION}:${ACCOUNT}:${PROJECT}-order-placed"
tf_import 'aws_cloudwatch_event_bus.bus' "${PROJECT}-bus"

# SNS → Lambda invoke permissions (deterministic statement ids).
for svc in inventory notifications; do
  tf_import "aws_lambda_permission.sns_invoke[\"$svc\"]" "${PROJECT}-${svc}/AllowSnsInvoke"
done

# EventBridge rules, targets, and the fan-out invoke permissions. Keys mirror deploy/main.tf's
# local.eventbridge_targets ("<rule_key>-<service>").
declare -A EB_TARGETS=(
  [payment_captured-notifications]=notifications
  [payment_captured-analytics]=analytics
  [shipment_dispatched-inventory]=inventory
  [shipment_dispatched-notifications]=notifications
  [shipment_dispatched-analytics]=analytics
)
for rule_key in payment_captured shipment_dispatched; do
  tf_import "aws_cloudwatch_event_rule.integration[\"$rule_key\"]" "${PROJECT}-bus/${PROJECT}-${rule_key}"
done
for key in "${!EB_TARGETS[@]}"; do
  svc="${EB_TARGETS[$key]}"
  rule_key="${key%-*}"
  tf_import "aws_cloudwatch_event_target.integration[\"$key\"]" "${PROJECT}-bus/${PROJECT}-${rule_key}/${svc}"
  tf_import "aws_lambda_permission.eventbridge_invoke[\"$key\"]" "${PROJECT}-${svc}/AllowEventBridge-${key}"
done

echo "Adoption pass complete."
