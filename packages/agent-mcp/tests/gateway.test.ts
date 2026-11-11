import test from "node:test";
import assert from "node:assert/strict";
import { McpGatewayServer } from "../src/mcpBridge.ts";
import { MeteredBillingLedger } from "../src/meteredBilling.ts";
import { evaluateAgentRuns } from "../src/evalHarness.ts";

test("McpGatewayServer validates required args and streams SSE frames", async () => {
  const gw = new McpGatewayServer();
  gw.registerTool({
    name: "query_zone_events",
    description: "Fetch camera zone dwell events",
    requiredArgs: ["cameraId"],
    handler: async (args) => ({ cameraId: args.cameraId, count: 2 }),
  });

  const missing = await gw.invokeStream("query_zone_events", {});
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);

  const ok = await gw.invokeStream("query_zone_events", { cameraId: "cam-sg-04" });
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 200);
  assert.equal(ok.frames.length, 2);
  assert.match(ok.frames[0], /event: tool_start/);
  assert.match(ok.frames[1], /event: tool_result/);
});

test("MeteredBillingLedger guarantees zero duplicate charges under retries", () => {
  const ledger = new MeteredBillingLedger();
  const first = ledger.recordUsage({
    idempotencyKey: "req-1001",
    tenantId: "org-zapdos",
    metric: "video_seconds",
    units: 120,
  });
  const retry = ledger.recordUsage({
    idempotencyKey: "req-1001",
    tenantId: "org-zapdos",
    metric: "video_seconds",
    units: 120,
  });

  assert.equal(first.deduplicated, false);
  assert.equal(retry.deduplicated, true);
  assert.equal(first.entry.amountMicroCents, 180000);

  ledger.recordUsage({
    idempotencyKey: "req-1002",
    tenantId: "org-zapdos",
    metric: "tts_chars",
    units: 500,
  });
  const summary = ledger.tenantInvoiceSummary("org-zapdos");
  assert.equal(summary.totalEvents, 2);
  assert.equal(summary.totalMicroCents, 189000);
});

test("evaluateAgentRuns blocks deployment when hallucinations exceed gate", () => {
  const clean = evaluateAgentRuns(
    [
      {
        sampleId: "s1",
        predictedLabel: "intrusion",
        expectedLabel: "intrusion",
        citedDocIds: ["kb-1"],
        allowedDocIds: ["kb-1", "kb-2"],
        latencyMs: 110,
      },
      {
        sampleId: "s2",
        predictedLabel: "clear",
        expectedLabel: "clear",
        citedDocIds: ["kb-2"],
        allowedDocIds: ["kb-1", "kb-2"],
        latencyMs: 145,
      },
    ],
    { minAccuracy: 0.9, maxP95Ms: 200, allowHallucinations: 0 }
  );
  assert.equal(clean.passedGate, true);

  const failing = evaluateAgentRuns(
    [
      {
        sampleId: "s3",
        predictedLabel: "clear",
        expectedLabel: "clear",
        citedDocIds: ["fabricated-doc"],
        allowedDocIds: ["kb-1"],
        latencyMs: 90,
      },
    ],
    { minAccuracy: 0.9, maxP95Ms: 200, allowHallucinations: 0 }
  );
  assert.equal(failing.hallucinatedCitations, 1);
  assert.equal(failing.passedGate, false);
});
