/**
 * store-config controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::store-config.store-config', () => ({
  async find(ctx) {
    ctx.query = {
      ...ctx.query,
      populate: {
        home_banners: {
          populate: ['desktop_image', 'mobile_image'],
        },
      },
    } as typeof ctx.query;

    const response = await super.find(ctx);

    const data = response?.data as
      | {
          home_banners?: Array<{ home_position?: number }>
          attributes?: { home_banners?: Array<{ home_position?: number }> };
        }
      | undefined;
    const banners = data?.home_banners ?? data?.attributes?.home_banners;

    if (Array.isArray(banners)) {
      banners.sort((current, next) => (current.home_position ?? 0) - (next.home_position ?? 0));
    }

    return response;
  },
}));
