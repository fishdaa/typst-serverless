/**
 * Pulumi stack: ECR repository for Typst Serverless container (Phase 2.6)
 * One-click deploy: pulumi up, then ./scripts/push-ecr.sh to build and push image
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const imageTag = config.get("imageTag") ?? "latest";

// ECR repository for the Typst Serverless container image
const repo = new aws.ecr.Repository("typst-serverless", {
  name: "typst-serverless",
  imageTagMutability: "MUTABLE",
  imageScanningConfiguration: {
    scanOnPush: true,
  },
});

// Lifecycle policy: keep last 5 images
new aws.ecr.LifecyclePolicy("typst-serverless-lifecycle", {
  repository: repo.name,
  policy: JSON.stringify({
    rules: [
      {
        rulePriority: 1,
        description: "Keep last 5 images",
        selection: {
          tagStatus: "any",
          countType: "imageCountMoreThan",
          countNumber: 5,
        },
        action: { type: "expire" },
      },
    ],
  }),
});

// Outputs
export const repositoryUrl = repo.repositoryUrl;
export const repositoryName = repo.name;
export const imageUri = pulumi.interpolate`${repo.repositoryUrl}:${imageTag}`;
