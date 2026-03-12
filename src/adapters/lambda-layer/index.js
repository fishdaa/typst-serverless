/**
 * Lambda entry point. Dispatches to API Gateway handler or direct invoke handler.
 */
import { handler as apiHandler } from "./api-handler.js";
import { handler as lambdaHandler } from "./handler.js";

function isApiGatewayEvent(event) {
  return event?.requestContext?.http != null || event?.version === "2.0";
}

export async function handler(event, context) {
  if (isApiGatewayEvent(event)) {
    return apiHandler(event, context);
  }
  return lambdaHandler(event, context);
}
