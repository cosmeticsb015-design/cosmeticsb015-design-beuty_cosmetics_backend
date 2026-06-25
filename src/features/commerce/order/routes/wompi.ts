const checkoutRateLimit = {
  name: 'global::rate-limit',
  config: { keyPrefix: 'wompi:checkout', windowMs: 60_000, max: 10 },
};

const paymentLinkRateLimit = {
  name: 'global::rate-limit',
  config: { keyPrefix: 'wompi:payment-link', windowMs: 60_000, max: 10 },
};

const webhookRateLimit = {
  name: 'global::rate-limit',
  config: { keyPrefix: 'wompi:webhook', windowMs: 60_000, max: 120 },
};

const publicOrderRateLimit = {
  name: 'global::rate-limit',
  config: { keyPrefix: 'orders:public', windowMs: 60_000, max: 20 },
};

export default {
  routes: [
    {
      method: 'POST',
      path: '/wompi/checkout',
      handler: 'order.create',
      config: { auth: false, middlewares: [checkoutRateLimit] },
    },
    {
      method: 'POST',
      path: '/payments/wompi/checkout',
      handler: 'order.create',
      config: { auth: false, middlewares: [checkoutRateLimit] },
    },
    {
      method: 'POST',
      path: '/checkout/wompi',
      handler: 'order.createWompiPaymentLink',
      config: { auth: false, middlewares: [paymentLinkRateLimit] },
    },
    {
      method: 'POST',
      path: '/orders/:id/wompi/payment-link',
      handler: 'order.createWompiPaymentLink',
      config: { auth: false, middlewares: [paymentLinkRateLimit] },
    },
    {
      method: 'POST',
      path: '/orders/:id/wompi-payment-link',
      handler: 'order.createWompiPaymentLink',
      config: { auth: false, middlewares: [paymentLinkRateLimit] },
    },
    {
      method: 'POST',
      path: '/wompi/webhook',
      handler: 'order.wompiWebhook',
      config: { auth: false, middlewares: [webhookRateLimit] },
    },
    {
      method: 'POST',
      path: '/payments/wompi/webhook',
      handler: 'order.wompiWebhook',
      config: { auth: false, middlewares: [webhookRateLimit] },
    },
    {
      method: 'GET',
      path: '/wompi/redirect',
      handler: 'order.wompiRedirect',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/payments/wompi/close',
      handler: 'order.wompiRedirect',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/gracias-por-su-compra',
      handler: 'order.wompiRedirect',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/checkout/gracias-por-su-compra',
      handler: 'order.wompiRedirect',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/orders/public/:identifier',
      handler: 'order.findPublic',
      config: { auth: false, middlewares: [publicOrderRateLimit] },
    },
  ],
};
