const checkoutRateLimit = {
  name: 'global::rate-limit',
  config: { keyPrefix: 'orders:create', windowMs: 60_000, max: 10 },
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
    { method: 'POST', path: '/wompi/checkout', handler: 'checkout-attempt.create', config: { auth: false, middlewares: [checkoutRateLimit] } },
    { method: 'POST', path: '/payments/wompi/checkout', handler: 'checkout-attempt.create', config: { auth: false, middlewares: [checkoutRateLimit] } },

    // Ruta nueva (preferida a futuro)
    { method: 'POST', path: '/checkout-attempts/:id/wompi-payment-link', handler: 'checkout-attempt.createWompiPaymentLink', config: { auth: false, middlewares: [paymentLinkRateLimit] } },
    // Alias legacy: el frontend sigue llamando /orders/:id/... con el documentId
    // del checkout-attempt que recibió en la respuesta de /wompi/checkout.
    // No requiere ningún cambio en el frontend.
    { method: 'POST', path: '/orders/:id/wompi/payment-link', handler: 'checkout-attempt.createWompiPaymentLink', config: { auth: false, middlewares: [paymentLinkRateLimit] } },
    { method: 'POST', path: '/orders/:id/wompi-payment-link', handler: 'checkout-attempt.createWompiPaymentLink', config: { auth: false, middlewares: [paymentLinkRateLimit] } },

    { method: 'POST', path: '/wompi/webhook', handler: 'checkout-attempt.wompiWebhook', config: { auth: false, middlewares: [webhookRateLimit] } },
    { method: 'POST', path: '/payments/wompi/webhook', handler: 'checkout-attempt.wompiWebhook', config: { auth: false, middlewares: [webhookRateLimit] } },

    { method: 'GET', path: '/wompi/redirect', handler: 'checkout-attempt.wompiRedirect', config: { auth: false } },
    { method: 'GET', path: '/payments/wompi/close', handler: 'checkout-attempt.wompiRedirect', config: { auth: false } },
    { method: 'GET', path: '/gracias-por-su-compra', handler: 'checkout-attempt.wompiRedirect', config: { auth: false } },
    { method: 'GET', path: '/checkout/gracias-por-su-compra', handler: 'checkout-attempt.wompiRedirect', config: { auth: false } },

    { method: 'GET', path: '/orders/public/:identifier', handler: 'checkout-attempt.findPublic', config: { auth: false, middlewares: [publicOrderRateLimit] } },
  ],
};