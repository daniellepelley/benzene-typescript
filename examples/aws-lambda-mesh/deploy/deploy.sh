#!/usr/bin/env bash
# One-command deploy of the AWS Lambda mesh: bundle the seven functions, then terraform apply.
#
# Prerequisites:
#   • AWS credentials in the environment (aws sts get-caller-identity should work)
#   • terraform >= 1.5 and node >= 22 on PATH
#   • run from anywhere — paths are resolved relative to this script
#
# Usage:  ./deploy.sh            # bundle + apply
#         AUTO_APPROVE=1 ./deploy.sh   # skip the interactive apply confirmation
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
example_dir="$(dirname "$script_dir")"

echo "== 1/2  Bundling the seven Lambda functions (esbuild → ../artifacts/*.zip) =="
( cd "$example_dir" && npm run bundle )

echo "== 2/2  terraform apply =="
cd "$script_dir"
terraform init -input=false
if [ "${AUTO_APPROVE:-0}" = "1" ]; then
  terraform apply -auto-approve
else
  terraform apply
fi

echo
echo "Done. Trigger the cascade with the orders_url output:"
echo "  curl -X POST \"\$(terraform output -raw orders_url)\" -H 'content-type: application/json' -d '{\"orderId\":\"o1\"}'"
echo "Then read the catalog the mesh built:"
echo "  aws s3 cp \"\$(terraform output -raw catalog_manifest_uri)\" -"
