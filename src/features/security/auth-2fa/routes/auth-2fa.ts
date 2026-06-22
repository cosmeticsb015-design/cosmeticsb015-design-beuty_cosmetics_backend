export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/local/2fa/start',
      handler: 'auth-2fa.start',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/auth/local/2fa/verify',
      handler: 'auth-2fa.verify',
      config: {
        auth: false,
      },
    },
  ],
};