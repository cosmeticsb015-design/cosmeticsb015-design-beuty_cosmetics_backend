import type { Schema, Struct } from '@strapi/strapi';

export interface StoreHomeBanner extends Struct.ComponentSchema {
  collectionName: 'components_store_home_banners';
  info: {
    description: 'Banner para el carrusel principal y promociones temporales del home';
    displayName: 'Home Banner';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    desktop_image: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    destination_url: Schema.Attribute.String;
    display_scope: Schema.Attribute.Enumeration<
      ['desktop_and_mobile', 'desktop_only', 'mobile_only']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'desktop_and_mobile'>;
    home_position: Schema.Attribute.Integer & Schema.Attribute.Required;
    mobile_image: Schema.Attribute.Media<'images'>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'store.home-banner': StoreHomeBanner;
    }
  }
}
