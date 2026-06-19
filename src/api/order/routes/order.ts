/**
 * order router
 */

import { factories } from '@strapi/strapi';

const checkoutRateLimit = {
  name: 'global::rate-limit',
  config: { keyPrefix: 'orders:create', windowMs: 60_000, max: 10 },
};

export default factories.createCoreRouter('api::order.order', {
  config: {
    create: { auth: false, middlewares: [checkoutRateLimit] },
  },
});
