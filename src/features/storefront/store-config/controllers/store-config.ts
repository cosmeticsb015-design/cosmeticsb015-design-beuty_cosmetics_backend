/**
 * store-config controller
 */

import { factories } from '@strapi/strapi';

type HomeBannerResponse = {
  active?: boolean;
  home_position?: number;
};

type StoreConfigResponse = {
  home_banners?: HomeBannerResponse[];
  attributes?: {
    home_banners?: HomeBannerResponse[];
  };
};

const populateHomeBanners = (ctx) => {
  ctx.query = {
    ...ctx.query,
    populate: {
      home_banners: {
        populate: ['desktop_image', 'mobile_image'],
      },
    },
  } as typeof ctx.query;
};

const sortBannersByHomePosition = (banners?: HomeBannerResponse[]) => {
  if (Array.isArray(banners)) {
    banners.sort((current, next) => (current.home_position ?? 0) - (next.home_position ?? 0));
  }
};

export default factories.createCoreController('api::store-config.store-config', () => ({
  async find(ctx) {
    populateHomeBanners(ctx);

    const response = await super.find(ctx);
    const data = response?.data as StoreConfigResponse | undefined;
    const banners = data?.home_banners ?? data?.attributes?.home_banners;

    sortBannersByHomePosition(banners);

    return response;
  },

  async findPublic(ctx) {
    populateHomeBanners(ctx);

    const response = await super.find(ctx);
    const data = response?.data as StoreConfigResponse | undefined;
    const banners = data?.home_banners ?? data?.attributes?.home_banners;

    if (Array.isArray(banners)) {
      const visibleBanners = banners
        .filter((banner) => banner.active !== false)
        .sort((current, next) => (current.home_position ?? 0) - (next.home_position ?? 0));

      if (data?.home_banners) {
        data.home_banners = visibleBanners;
      }

      if (data?.attributes?.home_banners) {
        data.attributes.home_banners = visibleBanners;
      }
    }

    return response;
  },
}));
