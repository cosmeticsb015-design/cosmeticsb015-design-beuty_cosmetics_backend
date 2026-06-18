import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: { includeUnparsed: true },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
