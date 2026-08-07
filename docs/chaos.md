# Chaos Engineering

Resilience patterns for transient failures and fault injection.

## Patterns

### Retry with Exponential Backoff

S3 and DynamoDB operations are wrapped with `withRetry` to handle transient failures:

- **Retryable errors:** exact codes `ECONNRESET`, `ETIMEDOUT`, `ThrottlingException`, `ServiceUnavailable`, `InternalServerError`, plus any error whose message matches `/timeout|retry|throttl|ECONNRESET|ETIMEDOUT/i`
- **Config:** `maxAttempts` (default 3), `baseDelayMs` (100), `maxDelayMs` (5000), `jitter` (default `true` — randomizes delay to avoid thundering herd)
- **Usage:** `resolve-input` uses retry for all S3 `GetObject` calls

### Circuit Breaker

Optional wrapper to fail fast when a dependency is unhealthy:

```ts
import { createCircuitBreaker } from "@/core/chaos.js";

const safeFetch = createCircuitBreaker(fetch, {
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeoutMs: 30000,
});
```

### Fault Injection (Tests)

Controlled via environment variables:

| Env | Description |
|-----|-------------|
| `TYPST_CHAOS_FAULT_RATE` | Failure probability 0–1 (e.g. `0.3` = 30% failures) |
| `TYPST_CHAOS_LATENCY_MS` | Fixed delay in ms before each call |

```ts
import { chaosInject } from "@/core/chaos.js";

const wrapped = chaosInject(async () => doSomething(), {
  faultRate: parseFloat(process.env.TYPST_CHAOS_FAULT_RATE || "0"),
  latencyMs: parseInt(process.env.TYPST_CHAOS_LATENCY_MS || "0", 10),
});
```

## Tests

```bash
npx vitest run test/chaos/
```

Tests cover:

- Retry: success on first attempt, retry then success, exhaustion, non-retryable skip
- Circuit breaker: pass-through when closed, open after threshold
- Fault injection: pass-through, fault when rate=1, latency
