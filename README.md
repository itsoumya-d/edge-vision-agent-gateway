# edge-vision-agent-gateway

End-to-end edge vision ingestion, MCP agent tool routing, metered Stripe-style billing, and deterministic regression evals:

- **Resumable Chunked Upload SDK (`packages/upload-sdk`)**: Splits video/telemetry streams into chunk offsets, computes per-chunk SHA-256 + HMAC signatures, recovers across uplink failures, and resumes without duplicate chunk transfers.
- **MCP Tool Gateway, Metered Billing & Eval Harness (`packages/agent-mcp`)**: Argument-validated MCP dispatcher emitting SSE `tool_start`/`tool_result` streams, double-entry idempotent usage billing ledger preventing duplicate retry charges, and latency/hallucination deployment gates.
- **Sliding-Window Spatial Zone Pipeline & Audit Ledger (`vision_worker`)**: IoU + dwell-time hysteresis suppressing transient flicker before confirming zone entry/exit, recorded into a SHA-256 hash-chained tamper-evident audit ledger.

## Local Verification

```bash
pytest -v
(cd packages/upload-sdk && npm install && npm run build && npm test)
(cd packages/agent-mcp && npm install && npm run build && npm test)
```
