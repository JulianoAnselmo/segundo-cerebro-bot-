// Token bucket por user — 20 ops/min default
const BUCKETS = new Map();
const DEFAULT = { capacity: 20, refillPerSec: 20 / 60 };

export function rateLimit({ capacity = DEFAULT.capacity, refillPerSec = DEFAULT.refillPerSec } = {}) {
  return async (ctx, next) => {
    const id = String(ctx.from?.id || 'anon');
    const now = Date.now() / 1000;
    let b = BUCKETS.get(id);
    if (!b) { b = { tokens: capacity, ts: now }; BUCKETS.set(id, b); }
    const elapsed = now - b.ts;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.ts = now;
    if (b.tokens < 1) {
      const wait = Math.ceil((1 - b.tokens) / refillPerSec);
      return ctx.reply(`⏳ Calma, muitas requests. Espera ${wait}s.`);
    }
    b.tokens -= 1;
    return next();
  };
}
