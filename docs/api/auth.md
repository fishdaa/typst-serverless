# API Gateway Authentication

This stack uses **API Gateway HTTP API (v2)**. Add authentication to protect your Typst API endpoints using one of the options below.

## Recommended options (HTTP API v2)

| Need | Recommended approach |
|------|------------------------|
| AWS-native callers (Lambda, SDK, CLI) | **IAM** — clients sign with SigV4 |
| Simple API key (`x-api-key` header) | **Lambda authorizer** — validate key and return IAM policy |
| JWT / OIDC | **JWT authorizer** (native) or **Lambda authorizer** |

HTTP APIs do **not** support REST-style usage plans or built-in API keys; use a Lambda authorizer for API-key-style auth.

---

## IAM Authorization

Best for: other AWS services, SDKs, or CLI callers.

1. Create an IAM user or role for API clients.
2. In Pulumi, set route authorization to `AWS_IAM` and ensure the route uses no other authorizer (IAM is the default when no authorizer is set, but you must restrict the resource policy so only signed requests are allowed, or attach an authorizer explicitly).
3. Clients sign requests with **AWS Signature Version 4** (e.g. `@aws-sdk/signature-v4` or the AWS SDK).

To enforce IAM: set `defaultRouteSettings.authorizationType` to `"AWS_IAM"` on the stage, or set `authorizationType: "AWS_IAM"` on each route. Until you do, the API allows unauthenticated access.

## API key (via Lambda authorizer)

HTTP API has no built-in API keys or usage plans. To require an API key:

1. Implement a **Lambda authorizer** that reads `x-api-key` (or `Authorization`), validates it (e.g. against a secret or DynamoDB), and returns an IAM policy.
2. Attach that authorizer to your HTTP API routes in Pulumi.
3. Clients send `x-api-key: <key>` (or the header you choose).

This is the recommended way to get “API key” auth on HTTP API.

## Lambda authorizer

For custom logic (API key, JWT, or other tokens):

1. Create a Lambda that validates the token (e.g. `Authorization` or `x-api-key`), and returns an IAM policy (allow/deny).
2. Create an `aws.apigatewayv2.Authorizer` with `authorizerType: "REQUEST"` and `authorizerUri` pointing to the Lambda.
3. Set each route’s `authorizationType` to `CUSTOM` and `authorizerId` to the authorizer.

See [AWS HTTP API Lambda authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html).

## JWT authorizer (native)

If you use an OIDC/OAuth2 issuer (e.g. Cognito, Auth0), you can use API Gateway’s built-in JWT authorizer instead of a Lambda:

- Create an `aws.apigatewayv2.Authorizer` with `authorizerType: "JWT"`, and set `identitySource` and JWT issuer/audience.
- Attach it to routes. Clients send `Authorization: Bearer <jwt>`.

See [AWS HTTP API JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html).
