import type { Core } from '@strapi/strapi';

const adminOtpEmailHtmlTemplate = `<!doctype html>
<html lang="es">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Código de verificación</title>
  </head>
  <body style="margin:0;padding:0;background:#fff7fb;font-family:Arial,Helvetica,sans-serif;color:#2f2f3a;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fff7fb;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #f3d6df;border-collapse:separate;border-spacing:0;">
            <tr>
              <td align="center" bgcolor="#cf527d" style="background:#cf527d;padding:30px 24px 26px;text-align:center;color:#fff7d9;">
                <div style="width:72px;height:72px;line-height:72px;border-radius:36px;background:#fff7d9;color:#cf527d;margin:0 auto 14px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;">BC</div>
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:30px;font-weight:700;color:#fff7d9;">Código de verificación</h1>
                <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#fff7d9;">Panel administrativo de Beauty Cosmetics</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px 28px;text-align:center;">
                <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#374151;">Copia y pega este código para completar tu inicio de sesión:</p>
                <div style="margin:0 auto 10px;padding:14px 18px;border:1px solid #f0c7d5;background:#fff0f5;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:38px;font-weight:700;letter-spacing:8px;color:#9e3659;text-align:center;word-break:break-all;">{{code}}</div>
                <p style="margin:0 0 22px;font-family:'Courier New',Courier,monospace;font-size:18px;line-height:24px;font-weight:700;color:#9e3659;text-align:center;">{{code}}</p>
                <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#6b7280;">Este código expira en <strong>{{expiryMinutes}} minutos</strong>.</p>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#8a6473;">Si no intentaste iniciar sesión, puedes ignorar este correo.</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#b08a98;">© ${new Date().getFullYear()} Beauty Cosmetics. Todos los derechos reservados.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const adminOtpEmailTextTemplate = 'Tu código de verificación es {{code}}. Expira en {{expiryMinutes}} minutos. Si no intentaste iniciar sesión en el panel de Beauty Cosmetics, ignora este correo.';

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
        emailSubject: env('ADMIN_OTP_EMAIL_SUBJECT', 'Tu código de verificación - Beauty Cosmetics'),
        emailTextTemplate: env('ADMIN_OTP_EMAIL_TEXT_TEMPLATE', adminOtpEmailTextTemplate),
        emailHtmlTemplate: env('ADMIN_OTP_EMAIL_HTML_TEMPLATE', adminOtpEmailHtmlTemplate),
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
