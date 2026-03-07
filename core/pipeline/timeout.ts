import { MAX_GENERATION_TIME_MS } from '../types.js';

/**
 * Budget tracker for the 2.5s generation time limit.
 * Use to enforce hard timeouts and allocate time across pipeline stages.
 */
export class TimeBudget {
  private readonly startTime: number;
  private readonly budgetMs: number;

  constructor(budgetMs: number = MAX_GENERATION_TIME_MS) {
    this.startTime = Date.now();
    this.budgetMs = budgetMs;
  }

  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  get remainingMs(): number {
    return Math.max(0, this.budgetMs - this.elapsedMs);
  }

  get isExpired(): boolean {
    return this.remainingMs <= 0;
  }

  createAbortSignal(): AbortSignal {
    return AbortSignal.timeout(this.remainingMs);
  }
}
