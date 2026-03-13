/**
 * Lambda entry point. Dispatches to API Gateway handler or direct invoke handler.
 */
import { handler as apiHandler } from "./api-handler.js";
import { handler as lambdaHandler } from "./handler.js";

function isApiGatewayEvent(event: unknown): boolean {
    const e = event as { requestContext?: { http?: unknown }; version?: string };
    return e?.requestContext?.http != null || e?.version === "2.0";
}

export async function handler(event: unknown, context?: unknown) {
    if (isApiGatewayEvent(event)) {
        return apiHandler(event as Parameters<typeof apiHandler>[0]);
    }
    return lambdaHandler(event as Parameters<typeof lambdaHandler>[0], context);
}
