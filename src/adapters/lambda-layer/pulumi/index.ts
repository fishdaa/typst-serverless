/**
 * Pulumi stack: Lambda + DynamoDB + S3 (Phase 2 MVP)
 * One-click deploy: npm run build:lambda && cd src/adapters/lambda-layer/pulumi && pulumi up
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = new pulumi.Config();
const retentionDays = config.getNumber("s3RetentionDays") ?? 7;
const enableApiGateway = config.getBoolean("enableApiGateway") ?? true;
const enableSqs = config.getBoolean("enableSqs") ?? false;
const customerOutputBuckets = config.get("customerOutputBuckets")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const projectRoot = path.resolve(__dirname, "../../../..");

// DynamoDB table: document_id (PK), status, s3_key, batch_id, timestamps
// GSI on batch_id for batch status queries (Phase 5)
const table = new aws.dynamodb.Table("typst-documents", {
  name: "typst-documents",
  hashKey: "document_id",
  billingMode: "PAY_PER_REQUEST",
  attributes: enableSqs
    ? [
        { name: "document_id", type: "S" },
        { name: "batch_id", type: "S" },
      ]
    : [{ name: "document_id", type: "S" }],
  globalSecondaryIndexes: enableSqs
    ? [
        {
          name: "batch_id-index",
          hashKey: "batch_id",
          rangeKey: "document_id",
          projectionType: "ALL",
        },
      ]
    : [],
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

// Allow browsers to PUT directly to presigned upload URLs (bypasses the API
// Gateway/Lambda payload limit for large assets like print-resolution poster
// backgrounds).
new aws.s3.BucketCorsConfigurationV2("typst-input-cors", {
  bucket: inputBucket.id,
  corsRules: [
    {
      allowedMethods: ["PUT"],
      allowedOrigins: ["*"],
      allowedHeaders: ["*"],
      maxAgeSeconds: 3600,
    },
  ],
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
    code: new pulumi.asset.FileArchive(layerZip),
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

// SQS queue (Phase 5) — optional, for batch via queue
let batchQueue: aws.sqs.Queue | undefined;
let batchQueueArn: pulumi.Output<string> | undefined;
if (enableSqs) {
  const dlq = new aws.sqs.Queue("typst-batch-dlq", {
    messageRetentionSeconds: 1209600, // 14 days
  });
  batchQueue = new aws.sqs.Queue("typst-batch-queue", {
    visibilityTimeoutSeconds: 120,
    messageRetentionSeconds: 345600, // 4 days
    redrivePolicy: dlq.arn.apply((arn) =>
      JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: 3 })
    ),
  });
  batchQueueArn = batchQueue.arn;
}

// Custom policy: DynamoDB + S3 (input + output buckets + optional customer buckets) + SQS when enabled
const policy = new aws.iam.RolePolicy("typst-lambda-policy", {
  role: role.id,
  policy: pulumi
    .all([table.arn, outputBucket.arn, inputBucket.arn, batchQueueArn ?? pulumi.output("")])
    .apply(([tableArn, outArn, inArn, queueArn]) => {
      const statements: object[] = [
        {
          Effect: "Allow",
          Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query"],
          Resource: [tableArn, `${tableArn}/index/*`],
        },
        {
          Effect: "Allow",
          Action: ["s3:PutObject", "s3:GetObject"],
          Resource: `${outArn}/*`,
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
          Resource: [inArn, `${inArn}/*`],
        },
      ];
      if (queueArn) {
        statements.push({
          Effect: "Allow",
          Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
          Resource: queueArn,
        });
        statements.push({
          Effect: "Allow",
          Action: ["sqs:SendMessage"],
          Resource: queueArn,
        });
      }
      for (const bucket of customerOutputBuckets) {
        const arn = bucket.startsWith("arn:") ? bucket : `arn:aws:s3:::${bucket}`;
        statements.push({
          Effect: "Allow",
          Action: ["s3:PutObject", "s3:GetObject"],
          Resource: `${arn}/*`,
        });
      }
      return JSON.stringify({ Version: "2012-10-17", Statement: statements });
    }),
});

// Use pre-built dist-lambda (run: npm run build:lambda)
const distDir = path.join(projectRoot, "dist-lambda");
if (!fs.existsSync(distDir)) {
  throw new Error(
    "Run 'npm run build:lambda' first to create dist-lambda/"
  );
}

// Package structure matches source: adapters/lambda-layer/, core/
const lambdaEnv: Record<string, pulumi.Output<string>> = {
  TYPST_STATE_TABLE: table.name,
  TYPST_OUTPUT_BUCKET: outputBucket.id,
  TYPST_INPUT_BUCKET: inputBucket.id,
  TYPST_ASSETS_BUCKET: inputBucket.id,
  TYPST_PATH: pulumi.output("/opt/bin/typst"),
};
if (enableSqs && batchQueue) {
  lambdaEnv.TYPST_BATCH_QUEUE_URL = batchQueue.url;
}

const lambda = new aws.lambda.Function("typst-compile", {
  runtime: "nodejs24.x",
  handler: "adapters/lambda-layer/index.handler",
  code: new pulumi.asset.FileArchive(distDir),
  role: role.arn,
  timeout: 90,
  memorySize: 1024,
  layers: typstLayer ? [typstLayer.arn] : [],
  environment: {
    variables: lambdaEnv,
  },
});

// SQS event source mapping (Phase 5)
if (enableSqs && batchQueue) {
  new aws.lambda.EventSourceMapping("typst-sqs-trigger", {
    eventSourceArn: batchQueue.arn,
    functionName: lambda.name,
    batchSize: 1,
  });
}

// API Gateway HTTP API (Phase 3)
let apiUrlOutput: pulumi.Output<string> | undefined;
if (enableApiGateway) {
  const api = new aws.apigatewayv2.Api("typst-api", {
    protocolType: "HTTP",
    name: "typst-serverless-api",
    corsConfiguration: {
      allowOrigins: ["*"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type"],
      maxAge: 86400,
    },
  });

  const integration = new aws.apigatewayv2.Integration("typst-lambda-integration", {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationUri: lambda.invokeArn,
    integrationMethod: "POST",
    payloadFormatVersion: "2.0",
  });

  const compileRoute = new aws.apigatewayv2.Route("compile-route", {
    apiId: api.id,
    routeKey: "POST /compile",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const batchRoute = new aws.apigatewayv2.Route("batch-route", {
    apiId: api.id,
    routeKey: "POST /batch",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const statusRoute = new aws.apigatewayv2.Route("status-route", {
    apiId: api.id,
    routeKey: "GET /status/{id}",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const uploadAssetRoute = new aws.apigatewayv2.Route("upload-asset-route", {
    apiId: api.id,
    routeKey: "POST /assets",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const presignUploadAssetRoute = new aws.apigatewayv2.Route("presign-upload-asset-route", {
    apiId: api.id,
    routeKey: "POST /assets/presign",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const listAssetsRoute = new aws.apigatewayv2.Route("list-assets-route", {
    apiId: api.id,
    routeKey: "GET /assets",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const downloadAssetRoute = new aws.apigatewayv2.Route("download-asset-route", {
    apiId: api.id,
    routeKey: "GET /assets/download/{path+}",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const deleteAssetRoute = new aws.apigatewayv2.Route("delete-asset-route", {
    apiId: api.id,
    routeKey: "DELETE /assets/{path+}",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const stage = new aws.apigatewayv2.Stage("typst-api-stage", {
    apiId: api.id,
    name: "$default",
    autoDeploy: true,
  });

  new aws.lambda.Permission("api-gateway-invoke", {
    action: "lambda:InvokeFunction",
    function: lambda.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
  });

  apiUrlOutput = pulumi.interpolate`${api.apiEndpoint}`;
}

// Outputs
export const functionName = lambda.name;
export const functionArn = lambda.arn;
export const stateTableName = table.name;
export const outputBucketName = outputBucket.id;
export const inputBucketName = inputBucket.id;
export const assetsBucketName = inputBucket.id;
export const apiUrl = apiUrlOutput;
export const batchQueueUrl = batchQueue?.url;
