/**
 * Pulumi stack: static hosting (S3 + CloudFront via Origin Access Control) for the
 * typst-serverless demo site. Build the site first with `npm run generate` in demo/
 * (NUXT_PUBLIC_API_BASE set to the backend's apiUrl), then `pulumi up` here.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as synced from "@pulumi/synced-folder";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const siteDir = path.resolve(__dirname, "../.output/public");
if (!fs.existsSync(siteDir)) {
  throw new Error(
    `Build output not found at ${siteDir}. Run 'npm run generate' in demo/ first (with NUXT_PUBLIC_API_BASE set to the backend's apiUrl).`
  );
}

const siteBucket = new aws.s3.BucketV2("demo-site", {
  bucketPrefix: "typst-demo-site-",
  forceDestroy: true,
});

new aws.s3.BucketPublicAccessBlock("demo-site-pab", {
  bucket: siteBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: false,
  ignorePublicAcls: true,
  restrictPublicBuckets: false,
});

const oac = new aws.cloudfront.OriginAccessControl("demo-site-oac", {
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});

const distribution = new aws.cloudfront.Distribution("demo-site-cdn", {
  enabled: true,
  defaultRootObject: "index.html",
  origins: [
    {
      originId: siteBucket.arn,
      domainName: siteBucket.bucketRegionalDomainName,
      originAccessControlId: oac.id,
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: siteBucket.arn,
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS"],
    cachedMethods: ["GET", "HEAD"],
    forwardedValues: {
      queryString: false,
      cookies: { forward: "none" },
    },
    minTtl: 0,
    defaultTtl: 300,
    maxTtl: 3600,
  },
  customErrorResponses: [
    { errorCode: 403, responseCode: 200, responsePagePath: "/index.html" },
    { errorCode: 404, responseCode: 200, responsePagePath: "/index.html" },
  ],
  restrictions: {
    geoRestriction: { restrictionType: "none" },
  },
  viewerCertificate: {
    cloudfrontDefaultCertificate: true,
  },
});

new aws.s3.BucketPolicy("demo-site-policy", {
  bucket: siteBucket.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Resource: pulumi.interpolate`${siteBucket.arn}/*`,
        Condition: {
          StringEquals: { "AWS:SourceArn": distribution.arn },
        },
      },
    ],
  }),
});

new synced.S3BucketFolder("demo-site-content", {
  path: siteDir,
  bucketName: siteBucket.bucket,
  acl: "private",
});

export const siteBucketName = siteBucket.id;
export const distributionId = distribution.id;
export const demoUrl = pulumi.interpolate`https://${distribution.domainName}`;
