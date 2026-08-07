/**
 * DynamoDB state store unit tests.
 * Mocks the DynamoDBDocumentClient; verifies command shape and response mapping.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { createDynamoDBState } from "@/core/state-dynamodb.js";
import { PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

function fakeClient(sendImpl: (command: unknown) => unknown): DynamoDBDocumentClient {
    return { send: sendImpl } as unknown as DynamoDBDocumentClient;
}

describe("core/state-dynamodb", () => {
    it("throws when no document client is provided", () => {
        assert.throws(() => createDynamoDBState(), /DocumentClient required/);
    });

    it("set() puts an item with document_id, status, and timestamps", async () => {
        let captured: unknown;
        const client = fakeClient((command) => {
            captured = command;
            return {};
        });
        const state = createDynamoDBState({ tableName: "docs-table", documentClient: client });
        await state.set("doc-1", { status: "pending", createdAt: 1000 });

        assert(captured instanceof PutCommand);
        const input = (captured as PutCommand).input;
        assert.strictEqual(input.TableName, "docs-table");
        assert.strictEqual(input.Item?.document_id, "doc-1");
        assert.strictEqual(input.Item?.status, "pending");
        assert.strictEqual(input.Item?.createdAt, 1000);
        assert(typeof input.Item?.updatedAt === "number");
    });

    it("set() omits optional fields (s3_key, error, batch_id) when not provided", async () => {
        let captured: unknown;
        const client = fakeClient((command) => {
            captured = command;
            return {};
        });
        const state = createDynamoDBState({ documentClient: client });
        await state.set("doc-2", { status: "pending" });

        const input = (captured as PutCommand).input;
        assert.strictEqual(input.Item?.s3_key, undefined);
        assert.strictEqual(input.Item?.s3_bucket, undefined);
        assert.strictEqual(input.Item?.error, undefined);
        assert.strictEqual(input.Item?.batch_id, undefined);
    });

    it("get() returns undefined when Item is missing", async () => {
        const client = fakeClient(() => ({ Item: undefined }));
        const state = createDynamoDBState({ documentClient: client });
        const doc = await state.get("missing-doc");
        assert.strictEqual(doc, undefined);
    });

    it("get() maps the returned Item to a JobState and uses GetCommand with document_id key", async () => {
        let captured: unknown;
        const client = fakeClient((command) => {
            captured = command;
            return {
                Item: {
                    document_id: "doc-3",
                    status: "completed",
                    s3_key: "outputs/doc-3.pdf",
                    s3_bucket: "my-bucket",
                },
            };
        });
        const state = createDynamoDBState({ tableName: "docs-table", documentClient: client });
        const doc = await state.get("doc-3");

        assert(captured instanceof GetCommand);
        const input = (captured as GetCommand).input;
        assert.strictEqual(input.TableName, "docs-table");
        assert.deepStrictEqual(input.Key, { document_id: "doc-3" });
        assert.strictEqual(doc?.status, "completed");
        assert.strictEqual(doc?.s3_key, "outputs/doc-3.pdf");
        assert.strictEqual(doc?.s3_bucket, "my-bucket");
    });

    it("update() builds an UpdateExpression only for the fields provided", async () => {
        let captured: unknown;
        const client = fakeClient((command) => {
            captured = command;
            return {};
        });
        const state = createDynamoDBState({ documentClient: client });
        await state.update("doc-4", { status: "failed", error: "compile error" });

        assert(captured instanceof UpdateCommand);
        const input = (captured as UpdateCommand).input;
        assert.deepStrictEqual(input.Key, { document_id: "doc-4" });
        assert(input.UpdateExpression?.includes("#status = :status"));
        assert(input.UpdateExpression?.includes("#error = :error"));
        assert(input.UpdateExpression?.includes("#updatedAt = :updated"));
        assert(!input.UpdateExpression?.includes("#s3_key"));
        assert.strictEqual(input.ExpressionAttributeValues?.[":status"], "failed");
        assert.strictEqual(input.ExpressionAttributeValues?.[":error"], "compile error");
    });

    it("update() with only s3_key/s3_bucket omits status and error from the expression", async () => {
        let captured: unknown;
        const client = fakeClient((command) => {
            captured = command;
            return {};
        });
        const state = createDynamoDBState({ documentClient: client });
        await state.update("doc-5", { s3_key: "out.pdf", s3_bucket: "bucket-x" });

        const input = (captured as UpdateCommand).input;
        assert(input.UpdateExpression?.includes("#s3_key = :s3_key"));
        assert(input.UpdateExpression?.includes("#s3_bucket = :s3_bucket"));
        assert(!input.UpdateExpression?.includes("#status"));
        assert(!input.UpdateExpression?.includes("#error"));
    });

    it("propagates errors thrown by the underlying DynamoDB client", async () => {
        const client = fakeClient(() => {
            throw new Error("ProvisionedThroughputExceededException");
        });
        const state = createDynamoDBState({ documentClient: client });
        await assert.rejects(
            () => state.get("doc-6"),
            /ProvisionedThroughputExceededException/
        );
    });
});
