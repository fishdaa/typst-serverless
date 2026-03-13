#!/usr/bin/env bash
# Provisions LocalStack with DynamoDB table and S3 buckets for typst-serverless tests.
# Usage: ./scripts/localstack-setup.sh
# Prereq: LocalStack running (localstack start or devbox run -- localstack start)

set -e
ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"

echo "LocalStack endpoint: $ENDPOINT"

# DynamoDB table
aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name typst-documents \
  --attribute-definitions AttributeName=document_id,AttributeType=S \
  --key-schema AttributeName=document_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || echo "Table typst-documents exists (or error)"

# S3 buckets
for b in typst-input-test typst-output-test; do
  aws --endpoint-url="$ENDPOINT" s3 mb "s3://$b" 2>/dev/null || echo "Bucket $b exists"
done

echo "Done. Run: TYPST_AWS_ENDPOINT=$ENDPOINT TYPST_STATE_TABLE=typst-documents TYPST_OUTPUT_BUCKET=typst-output-test npm run test:localstack"
