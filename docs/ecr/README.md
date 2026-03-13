# ECR / ECS / EKS Use Cases

Deploy the Typst Serverless container image to Amazon ECR and run it on ECS (Fargate) or EKS.

## Overview

| Component | Description |
|-----------|-------------|
| **ECR** | Store the Typst Serverless Docker image in a private registry |
| **ECS** | Run the container as a task (Fargate or EC2) |
| **EKS** | Run the container in a Kubernetes cluster |

## One-Click ECR Setup

1. **Create the ECR repository** (first time):
   ```bash
   cd src/adapters/ecr/pulumi
   npm install
   pulumi up
   ```

2. **Build and push the image**:
   ```bash
   ./scripts/push-ecr.sh
   # Or with a specific tag:
   ./scripts/push-ecr.sh v1.0.0
   ```

3. **Get the image URI** for ECS/EKS:
   ```bash
   cd src/adapters/ecr/pulumi
   pulumi stack output imageUri
   ```

## Configuration

| Config | Default | Description |
|--------|---------|-------------|
| `imageTag` | `latest` | Image tag to use for `imageUri` output |

Set via `pulumi config set imageTag v1.0.0`.

## ECS Fargate Example

After pushing the image to ECR, create an ECS task definition and service.

**Task definition** (minimal):

```json
{
  "family": "typst-serverless",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "typst",
      "image": "<ECR_URI>:latest",
      "environment": [
        { "name": "TYPST_WORKSPACE", "value": "/workspace" },
        { "name": "TYPST_MAIN", "value": "main.typ" }
      ],
      "mountPoints": [
        { "sourceVolume": "workspace", "containerPath": "/workspace" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/typst-serverless",
          "awslogs-region": "us-east-1"
        }
      }
    }
  ],
  "volumes": [
    { "name": "workspace" }
  ]
}
```

Use an EFS volume or S3 sync for the workspace; or invoke the task with input overrides (e.g. base64 main.typ in env).

## EKS Example

1. **Create a Deployment**:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: typst-serverless
spec:
  replicas: 1
  selector:
    matchLabels:
      app: typst-serverless
  template:
    metadata:
      labels:
        app: typst-serverless
    spec:
      containers:
        - name: typst
          image: <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/typst-serverless:latest
          env:
            - name: TYPST_WORKSPACE
              value: /workspace
            - name: TYPST_MAIN
              value: main.typ
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          emptyDir: {}
```

2. **Authenticate EKS to ECR**:
   - Use IAM roles for service accounts (IRSA), or
   - Create an imagePullSecrets from ECR credentials

## Lifecycle Policy

The Pulumi stack applies a lifecycle policy: only the last 5 images are retained. Older images are expired automatically.

## See Also

- [Container use cases](container/README.md) — Docker run modes (volume, pipe, state)
- [Lambda](lambda/README.md) — Serverless via Lambda (different deployment path)
