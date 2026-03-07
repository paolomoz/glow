import type { IntentVector, Signal } from '../types.js';
import type { AggregatedSignals } from './signals.js';

/**
 * Rules-based intent inference engine. No LLM calls — must be sub-100ms.
 * Uses signal aggregation + embedding similarity against pre-computed archetypes.
 */
export interface IntentEngine {
  /** Update intent state with a new batch of signals. */
  ingestSignals(currentIntent: IntentVector | null, signals: Signal[]): IntentVector;

  /** Infer intent from already-aggregated signals. */
  inferFromAggregated(
    currentIntent: IntentVector | null,
    aggregated: AggregatedSignals,
    sessionId: string
  ): IntentVector;
}
