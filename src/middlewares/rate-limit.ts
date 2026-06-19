type RateLimitConfig = {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

const normalizeEnvKey = (value: string) => value.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();

const getBooleanEnv = (name: string, defaultValue: boolean) => {
  const value = process.env[name];
  if (value === undefined) return defaultValue;

  return !['false', '0', 'off', 'no'].includes(value.toLowerCase());
};

const getNumberEnv = (name: string, defaultValue: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
};

const getClientIp = (ctx: any) =>
  String(ctx.request?.ip || ctx.ip || ctx.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim();

const cleanupExpiredBuckets = (now: number) => {
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
};

export default (_config: RateLimitConfig = {}, { strapi }: { strapi: any }) => {
  const keyPrefix = _config.keyPrefix || 'default';
  const envKey = normalizeEnvKey(keyPrefix);
  const enabled = getBooleanEnv(`RATE_LIMIT_${envKey}_ENABLED`, getBooleanEnv('RATE_LIMIT_ENABLED', true));
  const windowMs = getNumberEnv(
    `RATE_LIMIT_${envKey}_WINDOW_MS`,
    getNumberEnv('RATE_LIMIT_WINDOW_MS', Number(_config.windowMs || 60_000)),
  );
  const max = getNumberEnv(`RATE_LIMIT_${envKey}_MAX`, getNumberEnv('RATE_LIMIT_MAX', Number(_config.max || 30)));

  return async (ctx: any, next: () => Promise<void>) => {
    if (!enabled) {
      await next();
      return;
    }
    const now = Date.now();
    cleanupExpiredBuckets(now);

    const key = `${keyPrefix}:${getClientIp(ctx)}`;
    const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    buckets.set(key, entry);

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    ctx.set('X-RateLimit-Limit', String(max));
    ctx.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    ctx.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      strapi.log.warn(`Rate limit exceeded for ${key} on ${ctx.method} ${ctx.path}`);
      ctx.set('Retry-After', String(retryAfterSeconds));
      ctx.status = 429;
      ctx.body = { error: { message: 'Too many requests. Please try again later.' } };
      return;
    }

    await next();
  };
};
