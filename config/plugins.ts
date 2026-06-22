import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const mailer = env('MAIL_MAILER', env('EMAIL_PROVIDER', 'nodemailer'));
  const useMailjet = mailer === 'mailjet';
  const smtpUsername = env('SMTP_USERNAME', env('MAIL_USERNAME'));
  const smtpPassword = env('SMTP_PASSWORD', env('MAIL_PASSWORD'));
  const smtpSecure = env.bool(
    'SMTP_SECURE',
    env.bool('MAIL_SECURE', env('MAIL_ENCRYPTION', '').toLowerCase() === 'ssl')
  );

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
                host: env('SMTP_HOST', env('MAIL_HOST', 'smtp.hostinger.com')),
                port: env.int('SMTP_PORT', env.int('MAIL_PORT', 465)),
                secure: smtpSecure,
                auth:
                  smtpUsername || smtpPassword
                    ? {
                        user: smtpUsername,
                        pass: smtpPassword,
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
