export interface EvalSample {
  sampleId: string;
  predictedLabel: string;
  expectedLabel: string;
  citedDocIds: string[];
  allowedDocIds: string[];
  latencyMs: number;
}

export interface EvalReport {
  total: number;
  accuracy: number;
  hallucinatedCitations: number;
  p95LatencyMs: number;
  passedGate: boolean;
}

export function evaluateAgentRuns(
  samples: EvalSample[],
  thresholds: { minAccuracy: number; maxP95Ms: number; allowHallucinations: number }
): EvalReport {
  if (samples.length === 0) {
    return { total: 0, accuracy: 0, hallucinatedCitations: 0, p95LatencyMs: 0, passedGate: false };
  }

  let correct = 0;
  let hallucinations = 0;
  const latencies: number[] = [];

  for (const s of samples) {
    if (s.predictedLabel === s.expectedLabel) correct += 1;
    const allowed = new Set(s.allowedDocIds);
    if (s.citedDocIds.some((doc) => !allowed.has(doc))) {
      hallucinations += 1;
    }
    latencies.push(s.latencyMs);
  }

  latencies.sort((a, b) => a - b);
  const p95Idx = Math.min(latencies.length - 1, Math.floor(0.95 * (latencies.length - 1)));
  const p95LatencyMs = latencies[p95Idx];
  const accuracy = Number((correct / samples.length).toFixed(4));

  const passedGate =
    accuracy >= thresholds.minAccuracy &&
    p95LatencyMs <= thresholds.maxP95Ms &&
    hallucinations <= thresholds.allowHallucinations;

  return {
    total: samples.length,
    accuracy,
    hallucinatedCitations: hallucinations,
    p95LatencyMs,
    passedGate,
  };
}
