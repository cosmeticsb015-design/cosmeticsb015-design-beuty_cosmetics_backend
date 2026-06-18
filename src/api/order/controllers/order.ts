/**
 * order controller
 */

import { factories } from '@strapi/strapi';
import crypto from 'node:crypto';

const unparsedBody = Symbol.for('unparsedBody');

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to use Wompi payments`);
  return value;
};

const hmacSha256 = (value: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex');

const safeCompare = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left || '', 'hex');
  const rightBuffer = Buffer.from(right || '', 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const asBoolean = (value: unknown) => String(value).toLowerCase() === 'true';

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getOrderTotal = (order: any) => Number(order.subtotal || 0) + Number(order.shipping_cost || 0);

type OrderItemInput = {
  branch_stock?: string;
  branchStock?: string;
  branch_stock_id?: string;
  branchStockId?: string;
  quantity?: number;
};

const generateTrackingNumber = () => `BC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const defaultExpiresAt = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const getRelationDocumentId = (value: unknown) => {
  if (!value) return undefined;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const relation = value as { documentId?: string; id?: string | number };
    return relation.documentId || (relation.id ? String(relation.id) : undefined);
  }
  return undefined;
};

const normalizeOrderItems = (items: unknown): OrderItemInput[] => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one order item is required');
  }

  return items.map((item) => {
    const orderItem = item as OrderItemInput;
    const quantity = Number(orderItem.quantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Each order item quantity must be a positive integer');
    }

    const branchStock =
      orderItem.branch_stock ||
      orderItem.branchStock ||
      orderItem.branch_stock_id ||
      orderItem.branchStockId;

    if (!branchStock) {
      throw new Error('Each order item must include a branch_stock documentId');
    }

    return { branch_stock: String(branchStock), quantity };
  });
};

const isPublicHttpsUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !['localhost', '127.0.0.1', '0.0.0.0', 'your-domain.com'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
};

const getOptionalEnvUrl = (value: string | undefined) => {
  const normalized = (value || '').trim();
  return normalized && normalized.toLowerCase() !== 'false' ? normalized : '';
};

const getWompiWebhookUrl = () => {
  // Wompi allows an empty webhook URL; use that for QA/local environments without a public HTTPS domain.
  // WOMPI_WEBHOOK_QA_OVERRIDE=false explicitly disables the override and falls back to WOMPI_WEBHOOK_URL.
  const webhookUrl = getOptionalEnvUrl(process.env.WOMPI_WEBHOOK_QA_OVERRIDE) || getOptionalEnvUrl(process.env.WOMPI_WEBHOOK_URL);

  return webhookUrl && isPublicHttpsUrl(webhookUrl) ? webhookUrl : '';
};

const getWompiNotificationEmails = (order: any) =>
  (process.env.WOMPI_NOTIFICATION_EMAILS || order.customer_email || '').trim();

const getWompiErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Wompi payment link failed';

const getConfiguredWompiReturnUrl = () => {
  const returnUrl = (process.env.WOMPI_RETURN_URL || '').trim();
  if (returnUrl) return returnUrl;

  const storefrontUrl = (process.env.WOMPI_STOREFRONT_URL || '').trim();
  if (!storefrontUrl) return '';

  const thankYouPath = process.env.WOMPI_THANK_YOU_PATH || '/checkout/gracias-por-su-compra';
  try {
    return new URL(thankYouPath, storefrontUrl).toString();
  } catch {
    return '';
  }
};

const getWompiCustomerRedirectUrl = () => getConfiguredWompiReturnUrl() || requiredEnv('WOMPI_REDIRECT_URL');

const getWompiCustomerReturnUrl = () => getConfiguredWompiReturnUrl() || getWompiCustomerRedirectUrl();

const buildWompiPaymentLinkPayload = (order: any) => {
  const commerceId = `ORDER-${order.tracking_number}`;
  const total = getOrderTotal(order);

  if (total < 0.01) {
    throw new Error('Order total must be at least $0.01');
  }

  return {
    identificadorEnlaceComercio: commerceId,
    monto: Number(total.toFixed(2)),
    nombreProducto: `Orden ${order.tracking_number}`,
    configuracion: {
      urlRedirect: getWompiCustomerRedirectUrl(),
      urlRetorno: getWompiCustomerReturnUrl(),
      urlWebhook: getWompiWebhookUrl(),
      emailsNotificacion: getWompiNotificationEmails(order),
      notificarTransaccionCliente: true,
      esMontoEditable: false,
      esCantidadEditable: false,
      cantidadPorDefecto: 1,
    },
    limitesDeUso: { cantidadMaximaPagosExitosos: 1 },
    datosAdicionales: { orderDocumentId: order.documentId, trackingNumber: order.tracking_number },
  };
};

const attachWompiPaymentLink = async (strapi: any, order: any) => {
  if (order.wompi_payment_link_url || order.wompi_payment_link_long_url) {
    return {
      payment_link_id: order.wompi_payment_link_id,
      payment_url: order.wompi_payment_link_url || order.wompi_payment_link_long_url,
      qr_url: order.wompi_payment_link_qr_url,
    };
  }

  const wompi = strapi.service('api::order.wompi');
  const paymentLink = await wompi.createPaymentLink(buildWompiPaymentLinkPayload(order));

  await strapi.documents('api::order.order').update({
    documentId: order.documentId,
    data: ({
      wompi_payment_link_id: paymentLink.idEnlace,
      wompi_payment_link_url: paymentLink.urlEnlace,
      wompi_payment_link_long_url: paymentLink.urlEnlaceLargo,
      wompi_payment_link_qr_url: paymentLink.urlQrCodeEnlace,
    } as any),
    status: 'published',
  });

  return {
    payment_link_id: paymentLink.idEnlace,
    payment_url: paymentLink.urlEnlace || paymentLink.urlEnlaceLargo,
    qr_url: paymentLink.urlQrCodeEnlace,
  };
};


const buildWompiReturnUrl = (order: any, query: Record<string, unknown>) => {
  const returnUrl = getConfiguredWompiReturnUrl();
  if (!returnUrl) return undefined;

  try {
    const url = new URL(returnUrl);
    url.searchParams.set('order', order.documentId);
    url.searchParams.set('tracking_number', order.tracking_number);
    url.searchParams.set('payment_status', order.payment_status);
    url.searchParams.set('transaction_id', String(query.idTransaccion || ''));
    url.searchParams.set('approved', String(asBoolean(query.esAprobada)));
    return url.toString();
  } catch {
    return undefined;
  }
};

const findOrderByCommerceId = async (strapi: any, commerceId: string) => {
  const trackingNumber = commerceId.replace(/^ORDER-/, '');

  const orders = await strapi.documents('api::order.order').findMany({
    filters: { tracking_number: trackingNumber },
    status: 'published',
    limit: 1,
  });

  return orders[0];
};

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    const payload = ctx.request.body?.data || ctx.request.body || {};
    let inputItems: OrderItemInput[];

    try {
      inputItems = normalizeOrderItems(payload.items);
    } catch (error) {
      return ctx.badRequest(error instanceof Error ? error.message : 'Invalid order items');
    }
    const orderItems: any[] = [];
    let subtotal = 0;

    for (const item of inputItems) {
      const stock = await strapi.documents('api::branch-stock.branch-stock').findOne({
        documentId: item.branch_stock,
        populate: {
          branch: true,
          variant: { populate: { product: true } },
        },
      });

      if (!stock) return ctx.badRequest(`Branch stock ${item.branch_stock} was not found`);
      const available = Number(stock.quantity || 0);

      if (available < Number(item.quantity)) {
        return ctx.badRequest(`Insufficient stock for ${stock.variant?.label || item.branch_stock}`);
      }

      const product = stock.variant?.product;
      if (!product) return ctx.badRequest(`Branch stock ${item.branch_stock} is not linked to a product`);

      const unitPrice = Number(stock.variant?.price_override || product.price || 0);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return ctx.badRequest(`Invalid price for ${product.name}`);
      }

      subtotal += unitPrice * Number(item.quantity);
      orderItems.push({ stock, product, unitPrice, quantity: Number(item.quantity) });
    }

    const branchDocumentId = getRelationDocumentId(payload.branch) || orderItems[0]?.stock?.branch?.documentId;
    const shippingCost = Number(payload.shipping_cost || 0);

    if (!Number.isFinite(shippingCost) || shippingCost < 0) {
      return ctx.badRequest('Shipping cost must be a valid non-negative number');
    }

    const order = await strapi.documents('api::order.order').create({
      data: {
        tracking_number: payload.tracking_number || generateTrackingNumber(),
        customer_name: payload.customer_name,
        customer_email: payload.customer_email,
        customer_phone: payload.customer_phone,
        delivery_type: payload.delivery_type,
        address: payload.address,
        subtotal: Number(subtotal.toFixed(2)),
        shipping_cost: Number(shippingCost.toFixed(2)),
        payment_status: 'pending',
        expires_at: payload.expires_at || defaultExpiresAt(),
        branch: branchDocumentId,
        shipping_rate: getRelationDocumentId(payload.shipping_rate),
      },
      status: 'published',
    });

    for (const item of orderItems) {
      await strapi.documents('api::branch-stock.branch-stock').update({
        documentId: item.stock.documentId,
        data: { quantity: Number(item.stock.quantity || 0) - item.quantity },
        status: 'published',
      });

      await strapi.documents('api::order-item.order-item').create({
        data: {
          product_name: item.product.name,
          variant_label: item.stock.variant?.label,
          unit_price: Number(item.unitPrice.toFixed(2)),
          quantity: item.quantity,
          order: order.documentId,
          product: item.product.documentId,
          variant: item.stock.variant?.documentId,
          branch_stock: item.stock.documentId,
        },
        status: 'published',
      });
    }

    const createdOrder = await strapi.documents('api::order.order').findOne({
      documentId: order.documentId,
      populate: { items: true, branch: true, shipping_rate: true },
    });

    try {
      const wompiPayment = await attachWompiPaymentLink(strapi, createdOrder);
      ctx.status = 201;
      ctx.body = { data: { ...createdOrder, wompi_payment: wompiPayment } };
    } catch (error) {
      const message = getWompiErrorMessage(error);
      strapi.log.error('Unable to create Wompi payment link for checkout order', error);
      return ctx.internalServerError(`No se pudo crear el enlace de pago de Wompi para la orden: ${message}`);
    }
  },

  async createWompiPaymentLink(ctx) {
    const order = await strapi.documents('api::order.order').findOne({
      documentId: ctx.params.id,
      populate: { items: true },
    });

    if (!order) return ctx.notFound('Order not found');
    if (order.payment_status === 'paid') return ctx.badRequest('Order is already paid');

    try {
      const wompiPayment = await attachWompiPaymentLink(strapi, order);
      ctx.body = { data: { order: order.documentId, ...wompiPayment } };
    } catch (error) {
      const message = getWompiErrorMessage(error);
      if (message.includes('at least')) return ctx.badRequest(message);
      strapi.log.error('Unable to create Wompi payment link for existing order', error);
      return ctx.internalServerError(`No se pudo crear el enlace de pago de Wompi para la orden: ${message}`);
    }
  },

  async wompiWebhook(ctx) {
    const secret = requiredEnv('WOMPI_CLIENT_SECRET');
    const providedHash = String(ctx.get('wompi_hash') || '');
    const rawBody = ctx.request.body?.[unparsedBody];
    const bodyForHash = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');

    if (!providedHash || !bodyForHash || !safeCompare(hmacSha256(bodyForHash, secret), providedHash)) {
      return ctx.unauthorized('Invalid Wompi webhook signature');
    }

    const payload = ctx.request.body || {};
    const commerceId = payload.IdentificadorEnlaceComercio || payload.identificadorEnlaceComercio;
    const transactionId = payload.IdTransaccion || payload.idTransaccion;
    const isApproved = payload.ResultadoTransaccion === 'ExitosaAprobada' || payload.esAprobada === true;

    if (!commerceId || !transactionId) return ctx.badRequest('Missing Wompi transaction identifiers');

    const order = await findOrderByCommerceId(strapi, commerceId);
    if (!order) return ctx.notFound('Order not found for Wompi transaction');

    const expectedTotal = getOrderTotal(order);
    const receivedTotal = asNumber(payload.Monto || payload.monto);
    const paid = isApproved && Math.abs(expectedTotal - receivedTotal) < 0.01;

    await strapi.documents('api::order.order').update({
      documentId: order.documentId,
      data: {
        payment_status: paid ? 'paid' : 'failed',
        wompi_transaction_id: String(transactionId),
      },
      status: 'published',
    });

    ctx.body = { received: true };
  },

  async wompiRedirect(ctx) {
    const secret = requiredEnv('WOMPI_CLIENT_SECRET');
    const query = ctx.query;
    const providedHash = String(query.hash || '');
    const base = [
      query.identificadorEnlaceComercio,
      query.idTransaccion,
      query.idEnlace,
      query.monto,
    ].map((value) => String(value ?? '')).join('');

    if (!providedHash || !safeCompare(hmacSha256(base, secret), providedHash)) {
      return ctx.unauthorized('Invalid Wompi redirect signature');
    }

    const order = await findOrderByCommerceId(strapi, String(query.identificadorEnlaceComercio || ''));
    if (!order) return ctx.notFound('Order not found for Wompi redirect');

    const returnUrl = buildWompiReturnUrl(order, query);
    if (returnUrl) return ctx.redirect(returnUrl);

    ctx.body = {
      data: {
        order: order.documentId,
        payment_status: order.payment_status,
        transaction_id: query.idTransaccion,
        approved: asBoolean(query.esAprobada),
      },
    };
  },
}));
