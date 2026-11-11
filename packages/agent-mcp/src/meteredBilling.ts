export interface BillingEventInput {
  idempotencyKey: string;
  tenantId: string;
  metric: "tts_chars" | "video_seconds" | "agent_tokens";
  units: number;
}

export interface LedgerEntry extends BillingEventInput {
  unitPriceMicroCents: number;
  amountMicroCents: number;
  sequence: number;
}

const DEFAULT_RATES_MICRO_CENTS: Record<BillingEventInput["metric"], number> = {
  tts_chars: 18,
  video_seconds: 1500,
  agent_tokens: 4,
};

/**
 * Stripe-style idempotent metered usage ledger preventing duplicate billing under network retries.
 */
export class MeteredBillingLedger {
  private readonly seenKeys = new Map<string, LedgerEntry>();
  private readonly entries: LedgerEntry[] = [];
  private seq = 0;

  recordUsage(input: BillingEventInput): { deduplicated: boolean; entry: LedgerEntry } {
    if (input.units < 0) {
      throw new Error("Usage units must be non-negative");
    }
    const existing = this.seenKeys.get(input.idempotencyKey);
    if (existing) {
      return { deduplicated: true, entry: existing };
    }
    const rate = DEFAULT_RATES_MICRO_CENTS[input.metric];
    this.seq += 1;
    const entry: LedgerEntry = {
      ...input,
      unitPriceMicroCents: rate,
      amountMicroCents: input.units * rate,
      sequence: this.seq,
    };
    this.seenKeys.set(input.idempotencyKey, entry);
    this.entries.push(entry);
    return { deduplicated: false, entry };
  }

  tenantInvoiceSummary(tenantId: string): {
    tenantId: string;
    totalEvents: number;
    totalMicroCents: number;
    byMetric: Record<string, { units: number; microCents: number }>;
  } {
    const byMetric: Record<string, { units: number; microCents: number }> = {};
    let totalEvents = 0;
    let totalMicroCents = 0;
    for (const e of this.entries) {
      if (e.tenantId !== tenantId) continue;
      totalEvents += 1;
      totalMicroCents += e.amountMicroCents;
      if (!byMetric[e.metric]) {
        byMetric[e.metric] = { units: 0, microCents: 0 };
      }
      byMetric[e.metric].units += e.units;
      byMetric[e.metric].microCents += e.amountMicroCents;
    }
    return { tenantId, totalEvents, totalMicroCents, byMetric };
  }
}
