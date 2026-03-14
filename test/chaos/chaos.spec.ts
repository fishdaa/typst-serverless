/**
 * Chaos engineering tests.
 * Verifies retry, circuit breaker, and fault injection patterns.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { withRetry, createCircuitBreaker, chaosInject } from "@/core/chaos.js";

describe("chaos/withRetry", () => {
    it("succeeds on first attempt when no failure", async () => {
        let calls = 0;
        const result = await withRetry(async () => {
            calls++;
            return 42;
        });
        assert.strictEqual(result, 42);
        assert.strictEqual(calls, 1);
    });

    it("retries on retryable error and eventually succeeds", async () => {
        let attempts = 0;
        const err = new Error("ECONNRESET") as Error & { code?: string };
        err.code = "ECONNRESET";
        const result = await withRetry(
            async () => {
                attempts++;
                if (attempts < 2) throw err;
                return "ok";
            },
            { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }
        );
        assert.strictEqual(result, "ok");
        assert.strictEqual(attempts, 2);
    });

    it("throws after max attempts when all retries fail", async () => {
        let attempts = 0;
        const err = new Error("ECONNRESET") as Error & { code?: string };
        err.code = "ECONNRESET";
        await assert.rejects(
            () =>
                withRetry(
                    async () => {
                        attempts++;
                        throw err;
                    },
                    { maxAttempts: 3, baseDelayMs: 1 }
                ),
            /ECONNRESET/
        );
        assert.strictEqual(attempts, 3);
    });

    it("does not retry on non-retryable error", async () => {
        let attempts = 0;
        await assert.rejects(
            () =>
                withRetry(
                    async () => {
                        attempts++;
                        throw new Error("ValidationError");
                    },
                    {
                        maxAttempts: 3,
                        baseDelayMs: 1,
                        retryable: (e) => (e as Error).message.includes("ECONN"),
                    }
                ),
            /ValidationError/
        );
        assert.strictEqual(attempts, 1);
    });
});

describe("chaos/createCircuitBreaker", () => {
    it("passes through when closed", async () => {
        const fn = createCircuitBreaker(async (x: number) => x * 2, {
            failureThreshold: 2,
            successThreshold: 1,
            resetTimeoutMs: 100,
        });
        const r = await fn(21);
        assert.strictEqual(r, 42);
    });

    it("opens after failure threshold", async () => {
        let calls = 0;
        const fn = createCircuitBreaker(
            async () => {
                calls++;
                throw new Error("fail");
            },
            { failureThreshold: 2, resetTimeoutMs: 50 }
        );

        await assert.rejects(() => fn(), /fail/);
        await assert.rejects(() => fn(), /fail/);
        assert.strictEqual(calls, 2);

        await assert.rejects(() => fn(), /Circuit breaker open/);
        assert.strictEqual(calls, 2, "should not call fn when open");
    });
});

describe("chaos/chaosInject", () => {
    it("passes through when no fault rate", async () => {
        const wrapped = chaosInject(async () => 1, { faultRate: 0 });
        const r = await wrapped();
        assert.strictEqual(r, 1);
    });

    it("injects fault when faultRate=1", async () => {
        const wrapped = chaosInject(async () => 1, {
            faultRate: 1,
            faultError: new Error("injected"),
        });
        await assert.rejects(wrapped, /injected/);
    });

    it("adds latency when latencyMs set", async () => {
        const start = Date.now();
        const wrapped = chaosInject(async () => "ok", { latencyMs: 20 });
        await wrapped();
        assert(Date.now() - start >= 15, "should have delayed at least ~20ms");
    });
});
