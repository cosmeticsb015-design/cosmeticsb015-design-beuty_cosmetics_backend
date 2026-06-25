import { factories } from '@strapi/strapi';

const WOMPI_TOKEN_URL = process.env.WOMPI_URL_AUTH || process.env.WOMPI_TOKEN_URL || 'https://id.wompi.sv/connect/token';
const WOMPI_API_URL = (process.env.WOMPI_URL_API || process.env.WOMPI_API_URL || 'https://api.wompi.sv').replace(/\/$/, '');

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

    const response = await fetch(WOMPI_TOKEN_URL, {
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
    const response = await fetch(`${WOMPI_API_URL}${path}`, {
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

  // "Obtener Enlace de Pago por Id" — permite consultar activamente si un
  // enlace de pago ya tiene una transacción asociada (transaccionCompra) y
  // si esta fue aprobada, sin depender de que el webhook llegue ni de que
  // el cliente regrese al navegador. Ver https://docs.wompi.sv/metodos-api/
  async getPaymentLink(idEnlace: string | number) {
    return this.request(`/EnlacePago/${encodeURIComponent(String(idEnlace))}`);
  },
}));