import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const mailer = env('MAIL_MAILER', env('EMAIL_PROVIDER', 'nodemailer'));
  const useMailjet = mailer === 'mailjet';

  return {
    'admin-2fa': {
      enabled: true,
      config: {
        otpDigits: env.int('ADMIN_OTP_DIGITS', 6),
        otpTtlSeconds: env.int('ADMIN_OTP_TTL_SECONDS', 300),
        maxAttempts: env.int('ADMIN_OTP_MAX_ATTEMPTS', 5),
        maxResends: env.int('ADMIN_OTP_MAX_RESENDS', 3),
        rateLimitWindowSeconds: env.int('ADMIN_OTP_RATE_LIMIT_WINDOW_SECONDS', 900),
        loginIpLimit: env.int('ADMIN_OTP_LOGIN_IP_LIMIT', 10),
        loginEmailLimit: env.int('ADMIN_OTP_LOGIN_EMAIL_LIMIT', 5),
        verifyIpLimit: env.int('ADMIN_OTP_VERIFY_IP_LIMIT', 20),
        verifyEmailLimit: env.int('ADMIN_OTP_VERIFY_EMAIL_LIMIT', 10),
        resendIpLimit: env.int('ADMIN_OTP_RESEND_IP_LIMIT', 10),
        resendEmailLimit: env.int('ADMIN_OTP_RESEND_EMAIL_LIMIT', 5),
        debugTimings: env.bool('ADMIN_OTP_DEBUG_TIMINGS', false),
      },
    },
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
