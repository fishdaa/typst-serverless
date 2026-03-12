# API Gateway Authentication

Add authentication to protect your Typst API endpoints.

## IAM Authorization

To require AWS IAM authorization:

1. Create an IAM user or role for API clients
2. In Pulumi, set the route authorization to `AWS_IAM`:

```typescript
// In src/adapters/lambda-layer/pulumi/index.ts, add:
const api = new aws.apigatewayv2.Api("typst-api", {
  protocolType: "HTTP",
  // ... add:
  // corsConfiguration: { ... }
});

// For each route, add authorizer (or use defaultRouteSettings):
// Requires modifying the Route resources to use authorizerId
```

3. Clients sign requests with AWS Signature Version 4 (e.g. via `@aws-sdk/signature-v4` or AWS SDK).

## API Key

To add an API key:

1. Create an API key in API Gateway
2. Create a Usage Plan and associate it with your API stage
3. Require API key for the stage
4. Clients pass `x-api-key: <key>` header

Configure in Pulumi:

```typescript
const apiKey = new aws.apigatewayv2.ApiKey("typst-api-key", {
  name: "typst-api-key",
  description: "API key for Typst REST API",
});

const usagePlan = new aws.apigatewayv2.UsagePlan("typst-usage-plan", {
  apiId: api.id,
  name: "typst-default",
});

// Associate key with usage plan; add to stage
```

## Lambda Authorizer

For custom logic (e.g. JWT validation):

1. Create a Lambda authorizer that validates the `Authorization` header
2. Attach it to your API Gateway routes
3. Return IAM policy on success

See [AWS API Gateway Lambda authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html) for details.
