import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const mailer = env('MAIL_MAILER', env('EMAIL_PROVIDER', 'nodemailer'));
  const useMailjet = mailer === 'mailjet';

  return {
    email: {
      config: {
        provider: 'strapi-provider-email-extra',
        providerOptions: {
          defaultProvider: useMailjet ? 'mailjet' : 'nodemailer',
          providers: {
            nodemailer: {
              provider: 'nodemailer',
              providerOptions: {
                host: env('MAIL_HOST', '127.0.0.1'),
                port: env.int('MAIL_PORT', 1025),
                secure: env.bool('MAIL_ENCRYPTION', false),
                auth:
                  env('MAIL_USERNAME') || env('MAIL_PASSWORD')
                    ? {
                        user: env('MAIL_USERNAME'),
                        pass: env('MAIL_PASSWORD'),
                      }
                    : undefined,
              },
            },
            mailjet: {
              provider: 'mailjet',
              providerOptions: {
                apiKey: env('MAILJET_API_KEY'),
                apiSecret: env('MAILJET_API_SECRET'),
              },
            },
          },
        },
        settings: {
          defaultFrom: env('MAIL_FROM_ADDRESS', 'no-reply@beautycosmetics.local'),
          defaultFromName: env('MAIL_FROM_NAME', 'Beauty Cosmetics'),
          defaultReplyTo: env('MAIL_REPLY_TO', env('MAIL_FROM_ADDRESS', 'no-reply@beautycosmetics.local')),
        },
      },
    },
  };
};

export default config;
