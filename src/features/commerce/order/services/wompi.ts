import { factories } from '@strapi/strapi';

const WOMPI_TOKEN_URL = process.env.WOMPI_URL_AUTH || process.env.WOMPI_TOKEN_URL || 'https://id.wompi.sv/connect/token';
const WOMPI_API_URL = (process.env.WOMPI_URL_API || process.env.WOMPI_API_URL || 'https://api.wompi.sv').replace(/\/$/, '');
const WOMPI_REQUEST_TIMEOUT_MS = Number(process.env.WOMPI_REQUEST_TIMEOUT_MS) || 15_000;

type TokenResponse = {
  access_token: string;
  expires_in?: number;
};

let cachedToken: { accessToken: string; expiresAt: number } | undefined;

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to use Wompi payments`);
  return value;
};

// Envuelve fetch con un timeout explícito vía AbortController. Sin esto, una
// llamada que se quede colgada (red, endpoint inexistente, firewall que
// descarta paquetes en silencio, etc.) nunca resuelve ni rechaza, dejando
// bloqueado para siempre cualquier código que la esté esperando (esto es
// justo lo que pasaba con el cron de reconciliación de pagos: se quedaba
// pegado en la primera llamada, sin loguear éxito, fallo, ni error).
const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = WOMPI_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Wompi request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export default factories.createCoreService('api::order.order', ({ strapi }) => ({
  async getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.accessToken;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      audience: 'wompi_api',
      client_id: requiredEnv('WOMPI_CLIENT_ID'),
      client_secret: requiredEnv('WOMPI_CLIENT_SECRET'),
    });

    const response = await fetchWithTimeout(WOMPI_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      strapi.log.error(`Wompi token request failed with status ${response.status}: ${errorBody}`);
      throw new Error(`Unable to authenticate with Wompi (${response.status}): ${errorBody}`);
    }

    const token = (await response.json()) as TokenResponse;
    cachedToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() + ((token.expires_in || 300) * 1000),
    };

    return cachedToken.accessToken;
  },

  async request(path: string, init: RequestInit = {}) {
    const accessToken = await this.getAccessToken();
    const response = await fetchWithTimeout(`${WOMPI_API_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      strapi.log.error(`Wompi API request failed with status ${response.status}: ${errorBody}`);
      throw new Error(`Wompi API request failed (${response.status}): ${errorBody}`);
    }

    return response.json();
  },

  async createPaymentLink(payload: Record<string, unknown>) {
    return this.request('/EnlacePago', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getTransaction(transactionId: string) {
    return this.request(`/TransaccionCompra/${encodeURIComponent(transactionId)}`);
  },
}));