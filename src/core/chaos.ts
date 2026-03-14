/**
 * Chaos engineering patterns for resilience.
 * - withRetry: Exponential backoff for transient failures
 * - CircuitBreaker: Fail fast when dependency is unhealthy
 * - chaosInject: Fault injection for tests (controlled via env)
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  retryable?: (err: unknown) => boolean;
}

const DEFAULT_RETRYABLE = (err: unknown): boolean => {
    const e = err as Error & { code?: string };
    const code = e?.code;
    const msg = typeof e?.message === "string" ? e.message : "";
    return (
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ThrottlingException" ||
        code === "ServiceUnavailable" ||
        code === "InternalServerError" ||
        /timeout|retry|throttl|ECONNRESET|ETIMEDOUT/i.test(msg)
    );
};

/**
 * Retry an async operation with exponential backoff.
 * Use for S3, DynamoDB, and other transient-failure-prone calls.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: RetryOptions = {}
): Promise<T> {
    const maxAttempts = opts.maxAttempts ?? 3;
    const baseDelayMs = opts.baseDelayMs ?? 100;
    const maxDelayMs = opts.maxDelayMs ?? 5000;
    const jitter = opts.jitter ?? true;
    const retryable = opts.retryable ?? DEFAULT_RETRYABLE;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt === maxAttempts || !retryable(err)) {
                throw err;
            }
            const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
            const j = jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
            await new Promise((r) => setTimeout(r, j));
        }
    }
    throw lastErr;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  resetTimeoutMs?: number;
}

type State = "closed" | "open" | "half-open";

/**
 * Circuit breaker: stops calling a failing dependency after threshold.
 * In "open" state, fails fast. Periodically tries "half-open" to recover.
 */
export function createCircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    opts: CircuitBreakerOptions = {}
): T {
    const failureThreshold = opts.failureThreshold ?? 5;
    const successThreshold = opts.successThreshold ?? 2;
    const resetTimeoutMs = opts.resetTimeoutMs ?? 30000;

    let state: State = "closed";
    let failures = 0;
    let successes = 0;
    let lastFailureTime = 0;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const reset = (): void => {
        state = "half-open";
        successes = 0;
        failures = 0;
    };

    const wrapped = (async (...args: unknown[]) => {
        if (state === "open") {
            if (Date.now() - lastFailureTime >= resetTimeoutMs) {
                reset();
            } else {
                throw new Error("Circuit breaker open");
            }
        }

        try {
            const result = await fn(...args);
            if (state === "half-open") {
                successes++;
                if (successes >= successThreshold) {
                    state = "closed";
                    failures = 0;
                }
            } else if (state === "closed") {
                failures = 0;
            }
            return result;
        } catch (err) {
            failures++;
            lastFailureTime = Date.now();
            if (state === "half-open") {
                state = "open";
            } else if (failures >= failureThreshold) {
                state = "open";
            }
            throw err;
        }
    }) as T;

    return wrapped;
}

export interface ChaosInjectOptions {
  /** Failure probability 0–1. Only active when TYPST_CHAOS_FAULT_RATE set. */
  faultRate?: number;
  /** Fixed delay ms. Only active when TYPST_CHAOS_LATENCY_MS set. */
  latencyMs?: number;
  /** Custom error to throw on fault. */
  faultError?: Error;
}

/**
 * Fault injection for chaos tests.
 * Enable via env: TYPST_CHAOS_FAULT_RATE=0.3 (30% failure), TYPST_CHAOS_LATENCY_MS=100
 */
export function chaosInject<T>(fn: () => Promise<T>, opts: ChaosInjectOptions = {}): () => Promise<T> {
    const faultRate = opts.faultRate ?? parseFloat(process.env.TYPST_CHAOS_FAULT_RATE || "0");
    const latencyMs = opts.latencyMs ?? parseInt(process.env.TYPST_CHAOS_LATENCY_MS || "0", 10);
    const faultError = opts.faultError ?? new Error("Chaos: injected fault");

    return async () => {
        if (latencyMs > 0) {
            await new Promise((r) => setTimeout(r, latencyMs));
        }
        if (faultRate > 0 && Math.random() < faultRate) {
            throw faultError;
        }
        return fn();
    };
}
