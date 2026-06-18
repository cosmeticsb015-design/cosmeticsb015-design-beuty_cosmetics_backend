export default {
  routes: [
    {
      method: 'POST',
      path: '/orders/:id/wompi/payment-link',
      handler: 'order.createWompiPaymentLink',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/orders/:id/wompi-payment-link',
      handler: 'order.createWompiPaymentLink',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/wompi/webhook',
      handler: 'order.wompiWebhook',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/payments/wompi/webhook',
      handler: 'order.wompiWebhook',
      config: { auth: false },
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
  ],
};
