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

  },
};
