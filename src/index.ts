// import type { Core } from '@strapi/strapi';

const getWompiStorefrontReturnUrl = () => {
  const returnUrl = (process.env.WOMPI_RETURN_URL || '').trim();
  if (returnUrl) return returnUrl;

  const storefrontUrl = (process.env.WOMPI_STOREFRONT_URL || '').trim();
  if (!storefrontUrl) return '';

  const thankYouPath = process.env.WOMPI_THANK_YOU_PATH || '/checkout/gracias-por-su-compra';
  try {
    return new URL(thankYouPath, storefrontUrl).toString();
  } catch {
    return '';
  }
};

const appendQuery = (target: string, query: Record<string, unknown>) => {
  const url = new URL(target);

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
      return;
    }
    url.searchParams.set(key, String(value));
  });

  return url.toString();
};

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }) {
    const wompiThankYouRedirect = (ctx) => {
      const returnUrl = getWompiStorefrontReturnUrl();
      if (!returnUrl) return ctx.notFound('Wompi storefront return URL is not configured');

      return ctx.redirect(appendQuery(returnUrl, ctx.query));
    };

    strapi.server.routes([
      {
        method: 'GET',
        path: '/gracias-por-su-compra',
        handler: wompiThankYouRedirect,
        config: { auth: false },
      },
      {
        method: 'GET',
        path: '/checkout/gracias-por-su-compra',
        handler: wompiThankYouRedirect,
        config: { auth: false },
      },
    ]);

    // ---------------------------------------------------------------------
    // Red de seguridad de pagos Wompi: setInterval en vez de cron nativo
    // ---------------------------------------------------------------------
    // El cron nativo de Strapi (config/cron-tasks.ts, vía node-schedule) se
    // confirmó que NO ejecuta correctamente esta tarea al ser disparada por
    // el scheduler (el log de "tick" sale bien, pero el cuerpo de la función
    // nunca progresa ni loguea nada después). Llamando la MISMA función
    // directamente (sin pasar por node-schedule) funciona perfecto en
    // segundos. Por eso aquí se usa un setInterval simple, que es un
    // mecanismo mucho más directo y predecible para este caso puntual.
    const RECONCILE_WOMPI_INTERVAL_MS = 60_000;

    setInterval(() => {
      try {
        // require() perezoso (no en el top-level del archivo) para evitar
        // cualquier problema de orden de carga con el controlador.
        // IMPORTANTE: requerir vía 'api/order/...' (la ruta que pasa por el
        // symlink src/api/order -> ../features/commerce/order), NO vía
        // 'features/commerce/order/...' directo. Confirmado en producción
        // que el build de Strapi solo recompila de forma confiable el
        // artefacto bajo dist/src/api/order/..., mientras que
        // dist/src/features/commerce/order/... puede quedar desactualizado
        // entre builds (mismo archivo fuente, pero dos rutas/symlinks
        // distintos para el compilador). Requerir por la ruta equivocada
        // hacía que el setInterval corriera código viejo en silencio.
        const orderController = require('./api/order/controllers/order');
        const reconcilePendingWompiAttempts =
          orderController.reconcilePendingWompiAttempts || orderController.default?.reconcilePendingWompiAttempts;

        if (typeof reconcilePendingWompiAttempts !== 'function') {
          strapi.log.error('[interval] No se encontró reconcilePendingWompiAttempts en el controlador de order. Revisa el export.');
          return;
        }

        strapi.log.info('[interval] reconcilePendingWompiAttempts: tick');

        reconcilePendingWompiAttempts(strapi).catch((error: unknown) => {
          strapi.log.error('[interval] Error ejecutando reconcilePendingWompiAttempts', error);
        });
      } catch (error) {
        strapi.log.error('[interval] Error cargando reconcilePendingWompiAttempts', error);
      }
    }, RECONCILE_WOMPI_INTERVAL_MS);
  },
};