/**
 * Pulumi stack: Lambda + DynamoDB + S3 (Phase 2 MVP)
 * One-click deploy: npm run build:lambda && cd src/adapters/lambda-layer/pulumi && pulumi up
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as path from "path";
import * as fs from "fs";

const config = new pulumi.Config();
const retentionDays = config.getNumber("s3RetentionDays") ?? 7;
const projectRoot = path.resolve(__dirname, "../../../..");

// DynamoDB table: document_id (PK), status, s3_key, timestamps
const table = new aws.dynamodb.Table("typst-documents", {
  name: "typst-documents",
  hashKey: "document_id",
  billingMode: "PAY_PER_REQUEST",
  attributes: [{ name: "document_id", type: "S" }],
});

// S3 bucket for output PDFs (optional storage)
const outputBucket = new aws.s3.BucketV2("typst-output", {
  bucketPrefix: "typst-output-",
  forceDestroy: true,
});

// S3 bucket for input (main.typ via S3)
const inputBucket = new aws.s3.BucketV2("typst-input", {
  bucketPrefix: "typst-input-",
  forceDestroy: true,
});

// S3 lifecycle: expire output PDFs
new aws.s3.BucketLifecycleConfigurationV2("typst-output-lifecycle", {
  bucket: outputBucket.id,
  rules: [
    {
      id: "expire-outputs",
      status: "Enabled",
      expiration: { days: retentionDays },
      filter: { prefix: "outputs/" },
    },
  ],
});

// Typst Layer: use pre-built zip if exists
const layerZip = path.join(projectRoot, "src/adapters/lambda-layer/typst-layer.zip");
let typstLayer: aws.lambda.LayerVersion | undefined;

if (fs.existsSync(layerZip)) {
  typstLayer = new aws.lambda.LayerVersion("typst-layer", {
    filename: layerZip,
    layerName: "typst-binary",
    compatibleRuntimes: [aws.lambda.Runtime.NodeJS20dX],
  });
}

// IAM role for Lambda
const role = new aws.iam.Role("typst-lambda-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
});

new aws.iam.RolePolicyAttachment("lambda-basic", {
  role: role.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

// Custom policy: DynamoDB + S3 (input + output buckets)
const policy = new aws.iam.RolePolicy("typst-lambda-policy", {
  role: role.id,
  policy: pulumi
    .all([table.arn, outputBucket.arn, inputBucket.arn])
    .apply(([tableArn, outArn, inArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "dynamodb:PutItem",
              "dynamodb:GetItem",
              "dynamodb:UpdateItem",
            ],
            Resource: tableArn,
          },
          {
            Effect: "Allow",
            Action: ["s3:PutObject", "s3:GetObject"],
            Resource: `${outArn}/*`,
          },
          {
            Effect: "Allow",
            Action: ["s3:GetObject"],
            Resource: `${inArn}/*`,
          },
        ],
      })
    ),
});

// Use pre-built dist-lambda (run: npm run build:lambda)
const distDir = path.join(projectRoot, "dist-lambda");
if (!fs.existsSync(distDir)) {
  throw new Error(
    "Run 'npm run build:lambda' first to create dist-lambda/"
  );
}

// Package structure matches source: adapters/lambda-layer/, core/
const lambda = new aws.lambda.Function("typst-compile", {
  runtime: aws.lambda.Runtime.NodeJS20dX,
  handler: "adapters/lambda-layer/handler.handler",
  code: new pulumi.asset.FileArchive(distDir),
  role: role.arn,
  timeout: 60,
  memorySize: 512,
  layers: typstLayer ? [typstLayer.arn] : [],
  environment: {
    variables: {
      TYPST_STATE_TABLE: table.name,
      TYPST_OUTPUT_BUCKET: outputBucket.id,
      TYPST_INPUT_BUCKET: inputBucket.id,
      TYPST_PATH: "/opt/bin/typst",
    },
  },
});

// Outputs
export const functionName = lambda.name;
export const functionArn = lambda.arn;
export const stateTableName = table.name;
export const outputBucketName = outputBucket.id;
export const inputBucketName = inputBucket.id;
