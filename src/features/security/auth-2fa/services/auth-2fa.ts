import crypto from 'node:crypto';

type Challenge = {
  id: string;
  userId: number;
  email: string;
  otpHash: string;
  expiresAt: number;
  attempts: number;
  ip: string;
};

const createHttpError = (message: string, status: number) => {
  const error = new Error(message) as Error & { status?: number; statusCode?: number };
  error.status = status;
  error.statusCode = status;
  return error;
};

const createBadRequestError = (message: string) => createHttpError(message, 400);
const createForbiddenError = (message: string) => createHttpError(message, 403);
const createTooManyRequestsError = (message: string) => createHttpError(message, 429);

type RateRecord = {
  count: number;
  resetAt: number;
};

const challenges = new Map<string, Challenge>();
const rateLimits = new Map<string, RateRecord>();

const now = () => Date.now();

const getIntEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const getSettings = () => ({
  otpDigits: getIntEnv('USER_AUTH_2FA_OTP_DIGITS', 6),
  otpTtlSeconds: getIntEnv('USER_AUTH_2FA_OTP_TTL_SECONDS', 300),
  maxAttempts: getIntEnv('USER_AUTH_2FA_MAX_ATTEMPTS', 5),
  rateLimitWindowSeconds: getIntEnv('USER_AUTH_2FA_RATE_LIMIT_WINDOW_SECONDS', 900),
  startIpLimit: getIntEnv('USER_AUTH_2FA_START_IP_LIMIT', 10),
  startEmailLimit: getIntEnv('USER_AUTH_2FA_START_EMAIL_LIMIT', 5),
  verifyIpLimit: getIntEnv('USER_AUTH_2FA_VERIFY_IP_LIMIT', 20),
  verifyEmailLimit: getIntEnv('USER_AUTH_2FA_VERIFY_EMAIL_LIMIT', 10),
  allowedEmails: (process.env.USER_AUTH_2FA_ALLOWED_EMAILS || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean),
});

const hashOtp = (challengeId: string, otp: string) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET || process.env.APP_KEYS || 'local-2fa-secret')
    .update(`${challengeId}:${otp}`)
    .digest('hex');

const generateOtp = (digits: number) => {
  const safeDigits = Math.min(Math.max(digits, 4), 10);
  const max = 10 ** safeDigits;
  return crypto.randomInt(0, max).toString().padStart(safeDigits, '0');
};

const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 2))}@${domain}`;
};

const sanitizeUser = (user: unknown, ctx: any) => {
  const userSchema = strapi.getModel('plugin::users-permissions.user');
  return strapi.contentAPI.sanitize.output(user, userSchema, { auth: ctx.state.auth });
};

const pruneExpired = () => {
  const current = now();

  for (const [id, challenge] of challenges.entries()) {
    if (challenge.expiresAt <= current) {
      challenges.delete(id);
    }
  }

  for (const [key, record] of rateLimits.entries()) {
    if (record.resetAt <= current) {
      rateLimits.delete(key);
    }
  }
};

const assertRateLimit = (key: string, limit: number, windowSeconds: number) => {
  const current = now();
  const existing = rateLimits.get(key);

  if (!existing || existing.resetAt <= current) {
    rateLimits.set(key, { count: 1, resetAt: current + windowSeconds * 1000 });
    return;
  }

  if (existing.count >= limit) {
    throw createTooManyRequestsError('Too many 2FA attempts. Please try again later.');
  }

  existing.count += 1;
};

// ── Plantilla de correo (mismo lenguaje visual que order-email.ts) ──

const DEFAULT_OTP_EMAIL_LOGO_URL = 'https://raw.githubusercontent.com/codemarkdev/clientes-codemar/refs/heads/main/log.png';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getLogoUrl = () => {
  const configured = (process.env.ORDER_EMAIL_LOGO_URL || '').trim();
  return configured || DEFAULT_OTP_EMAIL_LOGO_URL;
};

const buildOtpEmail = (otp: string, ttlSeconds: number) => {
  const logoUrl = getLogoUrl();
  const expiryMinutes = Math.max(1, Math.floor(ttlSeconds / 60));
  const subject = 'Tu código de verificación - Beauty Cosmetics';

  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="72" height="72" alt="Beauty Cosmetics" style="display:block;margin:0 auto 14px;border:0;outline:none;text-decoration:none;border-radius:36px;" />`
    : `<div style="width:72px;height:72px;line-height:72px;border-radius:36px;background:#cf527d;color:#fff7d9;margin:0 auto 14px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;">BC</div>`;

  const html = `<!doctype html>
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
                ${logoHtml}
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:30px;font-weight:700;color:#fff7d9;">Código de verificación</h1>
                <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#fff7d9;">Panel administrativo de Beauty Cosmetics</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px 28px;text-align:center;">
                <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#374151;">Copia y pega este código para completar tu inicio de sesión:</p>
                <div style="margin:0 auto 10px;padding:14px 18px;border:1px solid #f0c7d5;background:#fff0f5;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:38px;font-weight:700;letter-spacing:8px;color:#9e3659;text-align:center;word-break:break-all;">${escapeHtml(otp)}</div>
                <p style="margin:0 0 22px;font-family:'Courier New',Courier,monospace;font-size:18px;line-height:24px;font-weight:700;color:#9e3659;text-align:center;">${escapeHtml(otp)}</p>
                <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#6b7280;">Este código expira en <strong>${expiryMinutes} minuto${expiryMinutes === 1 ? '' : 's'}</strong>.</p>
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

  const text = `Tu código de verificación es ${otp}. Expira en ${expiryMinutes} minuto${expiryMinutes === 1 ? '' : 's'}.\n\nSi no intentaste iniciar sesión en el panel de Beauty Cosmetics, ignora este correo.`;

  return { subject, html, text };
};

const sendOtpEmail = async (to: string, otp: string, ttlSeconds: number) => {
  const { subject, html, text } = buildOtpEmail(otp, ttlSeconds);
  await strapi.plugin('email').service('email').send({ to, subject, text, html });
};

const issueAuthResponse = async (user: any, ctx: any, deviceId?: string) => {
  const mode = String(strapi.config.get('plugin::users-permissions.jwtManagement', 'legacy-support'));

  if (mode === 'refresh') {
    const refresh = await strapi
      .sessionManager('users-permissions')
      .generateRefreshToken(String(user.id), deviceId, { type: 'refresh' });

    const access = await strapi.sessionManager('users-permissions').generateAccessToken(refresh.token);
    if ('error' in access) {
      throw createBadRequestError('Invalid credentials');
    }

    const upSessions = (strapi.config.get('plugin::users-permissions.sessions') || {}) as any;
    const requestHttpOnly = ctx.request.header['x-strapi-refresh-cookie'] === 'httpOnly';
    if (upSessions?.httpOnly || requestHttpOnly) {
      const cookieName = upSessions.cookie?.name || 'strapi_up_refresh';
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: typeof upSessions.cookie?.secure === 'boolean' ? upSessions.cookie.secure : isProduction,
        sameSite: upSessions.cookie?.sameSite ?? 'lax',
        path: upSessions.cookie?.path ?? '/',
        domain: upSessions.cookie?.domain,
        overwrite: true,
      };

      ctx.cookies.set(cookieName, refresh.token, cookieOptions);
      return { jwt: access.token, user: await sanitizeUser(user, ctx) };
    }

    return {
      jwt: access.token,
      refreshToken: refresh.token,
      user: await sanitizeUser(user, ctx),
    };
  }

  return {
    jwt: strapi.plugin('users-permissions').service('jwt').issue({ id: user.id }),
    user: await sanitizeUser(user, ctx),
  };
};

export default () => ({
  async startChallenge({ identifier, password, ip }: { identifier: string; password: string; ip: string }) {
    pruneExpired();

    const settings = getSettings();
    const normalizedIdentifier = identifier.trim();
    const emailKey = normalizeEmail(normalizedIdentifier);

    assertRateLimit(`2fa:start:ip:${ip}`, settings.startIpLimit, settings.rateLimitWindowSeconds);
    assertRateLimit(`2fa:start:email:${emailKey}`, settings.startEmailLimit, settings.rateLimitWindowSeconds);

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        provider: 'local',
        $or: [{ email: emailKey }, { username: normalizedIdentifier }],
      },
    });

    if (!user?.password) {
      throw createBadRequestError('Invalid identifier or password');
    }

    const isValidPassword = await strapi
      .plugin('users-permissions')
      .service('user')
      .validatePassword(password, user.password);

    if (!isValidPassword) {
      throw createBadRequestError('Invalid identifier or password');
    }

    const store = strapi.store({ type: 'plugin', name: 'users-permissions' });
    const advancedSettings = (await store.get({ key: 'advanced' })) as any;
    if (advancedSettings?.email_confirmation && user.confirmed !== true) {
      throw createBadRequestError('Your account email is not confirmed');
    }

    if (user.blocked === true) {
      throw createForbiddenError('Your account has been blocked by an administrator');
    }

    const userEmail = normalizeEmail(user.email || '');
    if (settings.allowedEmails.length > 0 && !settings.allowedEmails.includes(userEmail)) {
      throw createForbiddenError('This user is not allowed to use the 2FA login flow');
    }

    const challengeId = crypto.randomUUID();
    const otp = generateOtp(settings.otpDigits);

    challenges.set(challengeId, {
      id: challengeId,
      userId: user.id,
      email: userEmail,
      otpHash: hashOtp(challengeId, otp),
      expiresAt: now() + settings.otpTtlSeconds * 1000,
      attempts: 0,
      ip,
    });

    await sendOtpEmail(userEmail, otp, settings.otpTtlSeconds);

    return {
      twoFactorRequired: true,
      challengeId,
      expiresInSeconds: settings.otpTtlSeconds,
      email: maskEmail(userEmail),
    };
  },

  async verifyChallenge({ challengeId, code, deviceId, ctx, ip }: { challengeId: string; code: string; deviceId?: string; ctx: any; ip: string }) {
    pruneExpired();

    const settings = getSettings();
    const challenge = challenges.get(challengeId);

    if (!challenge) {
      throw createBadRequestError('Invalid or expired 2FA challenge');
    }

    assertRateLimit(`2fa:verify:ip:${ip}`, settings.verifyIpLimit, settings.rateLimitWindowSeconds);
    assertRateLimit(`2fa:verify:email:${challenge.email}`, settings.verifyEmailLimit, settings.rateLimitWindowSeconds);

    if (challenge.expiresAt <= now()) {
      challenges.delete(challengeId);
      throw createBadRequestError('Invalid or expired 2FA challenge');
    }

    if (challenge.attempts >= settings.maxAttempts) {
      challenges.delete(challengeId);
      throw createBadRequestError('Invalid or expired 2FA challenge');
    }

    const submittedHash = hashOtp(challengeId, code.trim());
    const valid = crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(challenge.otpHash));

    if (!valid) {
      challenge.attempts += 1;
      if (challenge.attempts >= settings.maxAttempts) {
        challenges.delete(challengeId);
      }
      throw createBadRequestError('Invalid verification code');
    }

    challenges.delete(challengeId);

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: challenge.userId },
    });

    if (!user || user.blocked === true) {
      throw createForbiddenError('Your account has been blocked by an administrator');
    }

    return issueAuthResponse(user, ctx, deviceId);
  },
});