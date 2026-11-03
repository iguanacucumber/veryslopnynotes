// Admission du mode PUBLIC : un seau par jeton (rafale + débit) puis une file
// FIFO bornée pour les scrapes. La boucle locale n'utilise pas ce module : elle
// garde son refus 503 immédiat au-delà de deux scrapes.
//
// Un jeton de seau est consommé AVANT la file : la file absorbe un pic, pas une
// rafale infinie. File pleine ou seau vide = refus immédiat, jamais une attente
// non bornée. Le temps est injectable pour des tests déterministes.

export interface AdmissionLimits {
  /** Jetons disponibles d'un coup (rafale). */
  readonly burst: number;
  /** Jetons reconstitués par seconde (débit de croisière). */
  readonly refillPerSecond: number;
  /** Scrapes réellement simultanés. */
  readonly maxConcurrent: number;
  /** Requêtes en attente au-delà des scrapes en cours. */
  readonly maxQueue: number;
}

export interface Admission {
  release(): void;
}

export type AdmissionResult =
  | { readonly ok: true; readonly admission: Admission }
  | { readonly ok: false; readonly retryAfterMs: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

interface Waiter {
  readonly key: string;
  readonly resolve: (result: AdmissionResult) => void;
  readonly signal?: AbortSignal;
  readonly onAbort: () => void;
  settled: boolean;
}

/** Sans reconstitution, il n'y a pas de prochain jeton : conseil honnête, borné. */
const NO_REFILL_RETRY_MS = 60_000;
const QUEUE_RETRY_MS = 1_000;

export class PublicAdmission {
  private readonly buckets = new Map<string, Bucket>();
  private readonly waiters: Waiter[] = [];
  private active = 0;

  constructor(
    private readonly limits: AdmissionLimits,
    private readonly now: () => number = Date.now,
  ) {
    if (!(limits.maxConcurrent >= 1)) throw new Error("maxConcurrent doit etre >= 1");
    if (!(limits.maxQueue >= 0)) throw new Error("maxQueue doit etre >= 0");
    if (!(limits.burst >= 0)) throw new Error("burst doit etre >= 0");
    if (!(limits.refillPerSecond >= 0)) throw new Error("refillPerSecond doit etre >= 0");
  }

  /**
   * Réserve un scrape. Le seau est propre au jeton (clé = empreinte du jeton,
   * jamais le secret) ; la file et la concurrence sont globales au process.
   */
  async acquire(key: string, signal?: AbortSignal): Promise<AdmissionResult> {
    if (signal?.aborted) return { ok: false, retryAfterMs: QUEUE_RETRY_MS };

    const retryAfterMs = this.take(key);
    if (retryAfterMs !== null) return { ok: false, retryAfterMs };

    if (this.active < this.limits.maxConcurrent) {
      this.active += 1;
      return { ok: true, admission: this.permit() };
    }
    if (this.waiters.length >= this.limits.maxQueue) {
      this.refund(key);
      return { ok: false, retryAfterMs: QUEUE_RETRY_MS };
    }

    return await new Promise<AdmissionResult>((resolve) => {
      const waiter: Waiter = {
        key,
        resolve,
        signal,
        onAbort: () => this.abandon(waiter),
        settled: false,
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private take(key: string): number | null {
    const bucket = this.bucket(key);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return null;
    }
    const missing = 1 - bucket.tokens;
    return this.limits.refillPerSecond > 0
      ? Math.ceil((missing / this.limits.refillPerSecond) * 1000)
      : NO_REFILL_RETRY_MS;
  }

  private refund(key: string): void {
    const bucket = this.bucket(key);
    bucket.tokens = Math.min(this.limits.burst, bucket.tokens + 1);
  }

  private bucket(key: string): Bucket {
    const existing = this.buckets.get(key);
    if (existing) {
      this.refill(existing);
      return existing;
    }
    const bucket: Bucket = { tokens: this.limits.burst, updatedAt: this.now() };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = this.now();
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
    if (elapsed > 0) {
      bucket.tokens = Math.min(this.limits.burst, bucket.tokens + elapsed * this.limits.refillPerSecond);
      bucket.updatedAt = now;
    }
  }

  private permit(): Admission {
    let released = false;
    return {
      release: () => {
        // Un double release rendrait un slot qui n'existe pas : la file
        // pourrait dépasser maxConcurrent.
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        this.pump();
      },
    };
  }

  /** Sert la file FIFO tant qu'un slot est libre. Aucun timer : libération seule. */
  private pump(): void {
    while (this.active < this.limits.maxConcurrent && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.settled) continue;
      waiter.settled = true;
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      this.active += 1;
      waiter.resolve({ ok: true, admission: this.permit() });
    }
  }

  /** Client parti avant son tour : le jeton emprunté est rendu, le slot intact. */
  private abandon(waiter: Waiter): void {
    if (waiter.settled) return;
    waiter.settled = true;
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    this.refund(waiter.key);
    waiter.resolve({ ok: false, retryAfterMs: QUEUE_RETRY_MS });
  }
}
