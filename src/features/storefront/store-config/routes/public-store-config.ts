export default {
  routes: [
    {
      method: 'GET',
      path: '/store-config/public',
      handler: 'store-config.findPublic',
      config: { auth: false },
    },
  ],
};
