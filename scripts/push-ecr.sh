#!/usr/bin/env bash
# Build and push Typst Serverless container image to ECR.
# Usage: ./scripts/push-ecr.sh [tag]
# Prereq: ECR repo created (cd src/adapters/ecr/pulumi && pulumi up)
#         AWS credentials configured (aws sts get-caller-identity)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_TAG="${1:-latest}"

# Get ECR repo URL from Pulumi output, or use env
if [[ -z "${ECR_REPO_URL}" ]]; then
  PULUMI_DIR="$PROJECT_ROOT/src/adapters/ecr/pulumi"
  if [[ -d "$PULUMI_DIR" ]]; then
    cd "$PULUMI_DIR"
    if command -v pulumi &>/dev/null; then
      ECR_REPO_URL=$(pulumi stack output repositoryUrl 2>/dev/null || true)
    fi
    cd - >/dev/null
  fi
fi

if [[ -z "${ECR_REPO_URL}" ]]; then
  echo "Error: ECR_REPO_URL not set. Either:"
  echo "  1. Run: cd src/adapters/ecr/pulumi && pulumi up"
  echo "  2. Set ECR_REPO_URL to your ECR repository URL (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/typst-serverless)"
  exit 1
fi

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
echo "ECR repo: $ECR_REPO_URL"
echo "Tag:      $IMAGE_TAG"
echo "Region:   $REGION"

# Login to ECR
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$(echo "$ECR_REPO_URL" | cut -d/ -f1)"

# Build and push
cd "$PROJECT_ROOT"
docker build -t "$ECR_REPO_URL:$IMAGE_TAG" .
docker push "$ECR_REPO_URL:$IMAGE_TAG"

echo "Pushed $ECR_REPO_URL:$IMAGE_TAG"
