type ServiceError = Error & { status?: number; statusCode?: number };

function sendServiceError(ctx: any, error: ServiceError) {
  const status = error?.status || error?.statusCode || 500;
  const message = error instanceof Error ? error.message : 'Internal Server Error';

  if (status === 400) return ctx.badRequest(message);
  if (status === 403) return ctx.forbidden(message);
  if (status === 429) {
    return typeof ctx.tooManyRequests === 'function' ? ctx.tooManyRequests(message) : ctx.throw(429, message);
  }

  strapi.log.error(error);

  // Solo en desarrollo exponemos el mensaje real para depurar más rápido.
  if (process.env.NODE_ENV !== 'production') {
    return ctx.internalServerError(message);
  }

  return ctx.internalServerError('Internal Server Error');
}

export default {
  async start(ctx: any) {
    const { identifier, password } = ctx.request.body || {};

    if (typeof identifier !== 'string' || typeof password !== 'string') {
      return ctx.badRequest('identifier and password are required');
    }

    try {
      const result = await strapi.service('api::auth-2fa.auth-2fa').startChallenge({
        identifier,
        password,
        ip: ctx.ip,
      });

      ctx.send(result);
    } catch (error) {
      sendServiceError(ctx, error as ServiceError);
    }
  },

  async verify(ctx: any) {
    const { challengeId, code, deviceId } = ctx.request.body || {};

    if (typeof challengeId !== 'string' || typeof code !== 'string') {
      return ctx.badRequest('challengeId and code are required');
    }

    try {
      const result = await strapi.service('api::auth-2fa.auth-2fa').verifyChallenge({
        challengeId,
        code,
        deviceId: typeof deviceId === 'string' ? deviceId : undefined,
        ctx,
        ip: ctx.ip,
      });

      ctx.send(result);
    } catch (error) {
      sendServiceError(ctx, error as ServiceError);
    }
  },
};