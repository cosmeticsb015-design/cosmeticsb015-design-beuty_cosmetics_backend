import type { Core } from '@strapi/strapi';

const parseList = (value?: string) =>
  (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const getUrlOrigin = (value?: string) => {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

const getCorsOrigins = () => {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...parseList(process.env.CORS_ORIGINS),
  ]);

  [
    process.env.FRONTEND_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.WOMPI_REDIRECT_URL,
    process.env.WOMPI_RETURN_URL,
    process.env.WOMPI_STOREFRONT_URL,
  ].forEach((value) => {
    const origin = getUrlOrigin(value);
    if (origin) origins.add(origin);
  });

  return Array.from(origins);
};

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: getCorsOrigins(),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: '*',
    },
  },
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
