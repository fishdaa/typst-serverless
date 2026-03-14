/**
 * Lambda entry point. Dispatches to API Gateway handler, SQS handler, or direct invoke handler.
 */
import { handler as apiHandler } from "./api-handler.js";
import { handler as lambdaHandler } from "./handler.js";

function isApiGatewayEvent(event: unknown): boolean {
    const e = event as { requestContext?: { http?: unknown }; version?: string };
    return e?.requestContext?.http != null || e?.version === "2.0";
}

function isSqsEvent(event: unknown): boolean {
    const e = event as { Records?: unknown[] };
    return Array.isArray(e?.Records) && e.Records.length > 0;
}

export async function handler(event: unknown, context?: unknown) {
    if (isApiGatewayEvent(event)) {
        return apiHandler(event as Parameters<typeof apiHandler>[0]);
    }
    if (isSqsEvent(event)) {
        return lambdaHandler({ action: "sqs", records: (event as { Records: { body: string }[] }).Records }, context);
    }
    return lambdaHandler(event as Parameters<typeof lambdaHandler>[0], context);
}
