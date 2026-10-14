/**
 * Sending in batches, with a pause between them.
 *
 * MES's first run on the September file had 242 first reminders due on one
 * morning. Sent back to back they arrive as a burst from one mailbox, which is
 * what spam filters and the providers' own rate limits are built to catch:
 * Gmail throttles an account that sends hundreds at once, and Microsoft 365 -
 * where MES's sending is going to move - refuses more than 30 messages a
 * minute from one mailbox outright.
 *
 * So letters go out a few at a time with a short random pause between batches,
 * and never faster than a per-minute ceiling. The defaults keep under
 * Microsoft's 30 a minute; all four numbers come from the environment, so they
 * can be tuned on Vercel without a code change.
 *
 * Pure apart from the clock and the sleep, which are passed in, so the
 * behaviour suite can run a whole morning in no time at all.
 */

export interface Pacing {
  /** Letters sent back to back before a pause. */
  batchSize: number;
  /** The pause between batches is a random time between these two. */
  minDelayMs: number;
  maxDelayMs: number;
  /** Never more than this many in any sixty seconds. */
  maxPerMinute: number;
}

/*
 * Ten at a time, a 3-5 second pause, never more than 28 a minute.
 *
 * The per-minute ceiling is what decides the pace; the batch size only decides
 * how bunched the letters are inside each minute. 28 sits just under
 * Microsoft 365's hard limit of 30 a minute from one mailbox, where MES's
 * sending is moving - above it Microsoft refuses the letters outright - and
 * well inside Gmail's and Google Workspace's daily allowances (about 500 and
 * 2,000 recipients). Raised from 5 and 25 on 15 October, when MES asked for
 * bigger batches.
 */
export const DEFAULT_PACING: Pacing = {
  batchSize: 10,
  minDelayMs: 3000,
  maxDelayMs: 5000,
  maxPerMinute: 28,
};

const whole = (v: string | undefined, fallback: number, min: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export function pacingFromEnv(env: NodeJS.ProcessEnv = process.env): Pacing {
  const minDelayMs = whole(env.MAIL_BATCH_DELAY_MIN_MS, DEFAULT_PACING.minDelayMs, 0);
  return {
    batchSize: whole(env.MAIL_BATCH_SIZE, DEFAULT_PACING.batchSize, 1),
    minDelayMs,
    maxDelayMs: Math.max(minDelayMs, whole(env.MAIL_BATCH_DELAY_MAX_MS, DEFAULT_PACING.maxDelayMs, 0)),
    maxPerMinute: whole(env.MAIL_MAX_PER_MINUTE, DEFAULT_PACING.maxPerMinute, 1),
  };
}

export interface PacedResult {
  /** How many of the items were handed to `send`, in order from the start. */
  attempted: number;
  /** How many were not reached before the deadline. */
  deferred: number;
}

/**
 * Sends `items` in order, paced, and stops before `deadline`.
 *
 * `send` is called for each item in turn; whatever it does with the result is
 * its business. Only an item that will itself start before the deadline is
 * attempted - the rest are reported as deferred, for the caller to pick up
 * later - and a pause that would run past the deadline is not taken, because
 * there is nothing after it to wait for.
 */
export async function sendPaced<T>(
  items: readonly T[],
  send: (item: T, index: number) => Promise<void>,
  opts: {
    pacing?: Pacing;
    /** Epoch ms. Nothing is started at or after this. */
    deadline: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    /** Told after each batch, for a progress line. */
    onBatch?: (attempted: number, total: number) => void;
    /**
     * When letters were really sent just before this call (epoch ms), so the
     * per-minute ceiling holds across a hand-over. A morning is several short
     * runs, each starting its count from zero; without this, a minute that
     * spans two of them could carry nearly twice the ceiling - 46 in a
     * simulation at 0.8 seconds an email.
     */
    sentJustBefore?: readonly number[];
  },
): Promise<PacedResult> {
  const p = opts.pacing ?? DEFAULT_PACING;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  /* When each of the most recent sends began, for the per-minute ceiling. */
  const recent: number[] = [...(opts.sentJustBefore ?? [])]
    .filter((t) => now() - t < 60_000)
    .sort((a, b) => a - b);
  let i = 0;

  while (i < items.length) {
    if (now() >= opts.deadline) break;

    for (let inBatch = 0; inBatch < p.batchSize && i < items.length; inBatch += 1) {
      /* The per-minute ceiling: if the last minute is full, wait for room. */
      for (;;) {
        while (recent.length > 0 && now() - recent[0]! >= 60_000) recent.shift();
        if (recent.length < p.maxPerMinute) break;
        const wait = recent[0]! + 60_000 - now();
        if (now() + wait >= opts.deadline) return { attempted: i, deferred: items.length - i };
        await sleep(wait);
      }
      if (now() >= opts.deadline) return { attempted: i, deferred: items.length - i };

      recent.push(now());
      await send(items[i]!, i);
      i += 1;
    }

    opts.onBatch?.(i, items.length);
    if (i >= items.length) break;

    const pause = p.minDelayMs + Math.round(random() * (p.maxDelayMs - p.minDelayMs));
    if (now() + pause >= opts.deadline) break;
    await sleep(pause);
  }

  return { attempted: i, deferred: items.length - i };
}
