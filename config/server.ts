import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('URL', `http://localhost:${env.int('PORT', 1337)}`),
  proxy: env.bool('IS_PROXIED', env('NODE_ENV', 'development') === 'production'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: false,
  },
});

export default config;