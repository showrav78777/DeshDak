# Crossly monitoring and performance runbook

## Current outcome

Crossly has a bounded, read-only performance probe and a vendor-neutral alert-policy template. Neither is evidence of production capacity or an active monitoring service. Real SLOs and alert thresholds must be approved after production-like staging measurements.

## Safety controls

- The exact target origin must be supplied twice and match.
- Non-local targets require HTTPS.
- The target must be classified as local, staging, or production.
- Production tests require `PERF_ALLOW_PRODUCTION=true` in addition to the exact-origin confirmation and an approved maintenance window.
- Only 1–20 same-origin GET paths are accepted.
- Requests are capped at 2,000 and concurrency at 50.
- Every request has a bounded timeout, redirects are rejected, response bodies are consumed, and status/error distributions are reported.
- A configurable warm-up phase is reported separately from the measured traffic.
- The command fails when p95 latency or error rate exceeds its configured release threshold.

## Commands

Use a production-like staging environment for release evidence:

```text
PERF_BASE_URL=https://staging.example.com
PERF_CONFIRM_TARGET_ORIGIN=https://staging.example.com
PERF_TARGET_CLASS=staging
PERF_REQUESTS=500
PERF_CONCURRENCY=10
PERF_MAX_P95_MS=1500
PERF_MAX_ERROR_RATE=0.01
npm run ops:performance
```

The local-only form may use HTTP when explicitly allowed:

```text
PERF_BASE_URL=http://localhost:3000
PERF_CONFIRM_TARGET_ORIGIN=http://localhost:3000
PERF_TARGET_CLASS=local
PERF_ALLOW_HTTP=true
npm run ops:performance
```

Do not place authenticated URLs, tokens, cookies, payment information, customer identifiers, or mutation endpoints in `PERF_PATHS`. Authenticated workflow load tests require a separate approved synthetic-data harness and isolated accounts.

## Local evidence from 31 August 2026

A 60-request, concurrency-5 run against the development server produced zero HTTP failures. The first cold run reported p95 3,908 ms because routes were compiled on demand and correctly failed a 3,000 ms gate. After adding and reporting one warm-up request per path, the steady-state run reported p50 179 ms, p95 225 ms, p99 245 ms, maximum 245 ms, and 33.23 requests/second.

These numbers describe one local development machine and must not be used as a production capacity claim. Staging must use the optimized production build, production-like database size, connection pooling, network path, CDN/WAF, and representative data.

## Local evidence from 9 September 2026

A fresh bounded run sent 100 read-only requests at concurrency 5 across the homepage, product catalog, and liveness endpoint after one warm-up request per path. All 100 responses returned HTTP 200 with zero failures. Measured throughput was 29.59 requests/second; latency was p50 198 ms, p95 265 ms, p99 277 ms, and maximum 282 ms. The configured 1,500 ms p95 and 1% error-rate gates passed.

This confirms the current local development runtime has no reproducible public-read bottleneck under the bounded probe. It does not establish production capacity or "unlimited load". The staging acceptance procedure below remains mandatory.

## Monitoring signals

Connect the selected monitoring platform to:

- API RED metrics: request rate, error rate, and duration by normalized route and status class.
- Liveness/readiness, instance restarts, CPU/memory, database connections/latency/storage, queue depth/age, and certificate expiry.
- Payment checkout/webhook/reconciliation failures, refund failures, wallet/journal integrity alerts, and duplicate/replay rejection rates.
- Order transition failures, Warehouse/Logistics scan failures, sourcing-adapter health, inventory reservation expiry, and carrier/provider circuit state.
- Support/Compliance SLA breaches, scheduled-maintenance lateness/failure, notification delivery failures, backup success/age, and restore-drill age.

Never send cookies, authorization headers, tokens, request bodies, customer PII, payment data, private media, provider credentials, or raw database errors to metrics/log labels.

## Alert operation

`ops/monitoring/alert-policy.example.json` is a proposed mapping, not active infrastructure. The owner must assign real people to each role, connect paging and escalation channels, approve warning/critical thresholds, suppress duplicate noise, test every alert, and record acknowledgements and incident outcomes.

For critical readiness, payment-integrity, financial-integrity, or data-integrity alerts: stop or reduce traffic, preserve evidence, activate the incident commander, and use the deployment/recovery runbook. Do not automatically mark orders paid, rewrite financial journals, or skip state guards to clear an alert.

## Staging performance acceptance

1. Seed anonymized/synthetic production-like products, users, orders, tracking, and Help content.
2. Deploy the optimized production build with production-like PostgreSQL, pooling, cache/queue, object storage, and edge controls.
3. Warm the chosen public read paths, run the bounded baseline, and retain raw output plus release identifier.
4. Use a separate approved harness for checkout, payment worker, notification worker, search, tracking, and role workflows.
5. Run sustained soak and controlled stress tests while observing resource saturation, database locks/connections, queues, error rate, p95/p99, and recovery.
6. Fix the bottleneck, rerun, document measured capacity and safe operating limits, then obtain Operations/Finance/Compliance sign-off.

## External work still required

Select and configure the production monitoring/logging/tracing provider, dashboards, alert delivery, on-call rota, retention/access controls, synthetic probes, capacity target, traffic model, testing budget, and incident ownership. Independent load/security testing remains a paid-launch gate.
