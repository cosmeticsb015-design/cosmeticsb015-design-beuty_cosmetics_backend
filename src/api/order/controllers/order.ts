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

const getWompiResultLabel = (value: unknown) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  const resultMap: Record<string, string> = {
    '0': 'ExitosaAprobada',
    '1': 'ExitosaDeclinada',
    '2': 'Fallida',
  };

  return resultMap[normalized] || normalized;
};

const getWompiPaymentMethodLabel = (value: unknown) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  const paymentMethodMap: Record<string, string> = {
    '0': 'PagoNormal',
    '1': 'Puntos',
    '2': 'Cuotas',
    '3': 'Bitcoin',
    '4': 'QuickPay',
  };

  return paymentMethodMap[normalized] || normalized;
};

const getPaymentStatusFromWompiRedirect = (query: Record<string, unknown>) => {
  if (asBoolean(query.esAprobada)) return 'paid';

  const result = getWompiResultLabel(query.resultadoTransaccion || query.ResultadoTransaccion).toLowerCase();
  if (['exitosadeclinada', 'fallida'].includes(result)) return 'failed';

  return 'pending';
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

const getPublicOrderAccessTtlMs = () => {
  const minutes = Number(process.env.PUBLIC_ORDER_ACCESS_TTL_MINUTES || 0);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;

  const hours = Number(process.env.PUBLIC_ORDER_ACCESS_TTL_HOURS || 24);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
};

const getPublicOrderAccessExpiresAt = (order: any) => {
  const explicitExpiration = order?.expires_at ? Date.parse(order.expires_at) : Number.NaN;
  if (Number.isFinite(explicitExpiration)) return explicitExpiration;

  const createdAt = order?.createdAt ? Date.parse(order.createdAt) : Number.NaN;
  if (Number.isFinite(createdAt)) return createdAt + getPublicOrderAccessTtlMs();

  return Date.now() + getPublicOrderAccessTtlMs();
};

const isPublicOrderAccessExpired = (order: any) => Date.now() > getPublicOrderAccessExpiresAt(order);

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

const buildBackendWompiRedirectUrl = (publicBackendUrl: string) => {
  try {
    return new URL('/api/wompi/redirect', publicBackendUrl).toString();
  } catch {
    return '';
  }
};

const looksLikeStorefrontThankYouUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const thankYouPath = process.env.WOMPI_THANK_YOU_PATH || '/checkout/gracias-por-su-compra';
    return parsed.pathname === thankYouPath || parsed.pathname === '/gracias-por-su-compra';
  } catch {
    return false;
  }
};

// urlRedirect: la URL que Wompi llama PRIMERO al terminar el pago.
// SIEMPRE debe ser el BACKEND, porque aquí es donde validamos el hash de Wompi
// antes de reenviar al cliente al frontend. Si WOMPI_REDIRECT_URL quedó apuntando
// al storefront por compatibilidad, derivamos el redirect público desde el webhook
// o desde WOMPI_BACKEND_URL para evitar enviar a Wompi directo al frontend.
const appendOrderReturnParams = (redirectUrl: string, order: any) => {
  try {
    const url = new URL(redirectUrl);
    url.searchParams.set('order', order.documentId);
    url.searchParams.set('tracking_number', order.tracking_number);
    url.searchParams.set('payment_status', order.payment_status);
    return url.toString();
  } catch {
    return redirectUrl;
  }
};

const getWompiCustomerRedirectUrl = (order: any) => {
  const configuredRedirectUrl = requiredEnv('WOMPI_REDIRECT_URL').trim();

  const redirectUrl = looksLikeStorefrontThankYouUrl(configuredRedirectUrl)
    ? buildBackendWompiRedirectUrl(process.env.WOMPI_BACKEND_URL || '') ||
      buildBackendWompiRedirectUrl(getWompiWebhookUrl()) ||
      configuredRedirectUrl
    : configuredRedirectUrl;

  return appendOrderReturnParams(redirectUrl, order);
};

// Destino final para el cliente (FRONTEND), una vez que el backend valida la transacción
// en wompiRedirect() y hace el ctx.redirect(...) hacia aquí.
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

const getWompiCustomerReturnUrl = (order: any) =>
  getConfiguredWompiReturnUrl() || getWompiCustomerRedirectUrl(order);

// Wompi's "Enlace de Pago" no soporta una lista de items: solo nombreProducto (string)
// e infoProducto.descripcionProducto (string). Construimos ambos a partir de los
// order-items reales en vez de usar solo el tracking number.
const WOMPI_PRODUCT_NAME_MAX_LENGTH = 120;

const formatOrderItemLabel = (item: any) => {
  const variant = item.variant_label ? ` (${item.variant_label})` : '';
  return `${item.product_name}${variant} x${item.quantity}`;
};

const buildWompiProductName = (order: any) => {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return `Orden ${order.tracking_number}`;

  const joined = items.map(formatOrderItemLabel).join(', ');
  if (joined.length <= WOMPI_PRODUCT_NAME_MAX_LENGTH) return joined;

  return `${joined.slice(0, WOMPI_PRODUCT_NAME_MAX_LENGTH - 1)}…`;
};

const buildWompiProductDescription = (order: any) => {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return `Orden ${order.tracking_number}`;

  return items.map(formatOrderItemLabel).join(' | ');
};

const publicOrderPopulate = {
  items: {
    populate: {
      product: { populate: { images: { populate: { image: true } }, brand: true, category: true } },
      variant: { populate: { images: { populate: { image: true } } } },
    },
  },
  branch: true,
  shipping_rate: true,
};

const getPublicAssetBaseUrl = () =>
  (process.env.STRAPI_PUBLIC_URL || process.env.PUBLIC_URL || process.env.WOMPI_BACKEND_URL || '').replace(/\/$/, '');

const normalizeMedia = (media: any) => {
  if (!media?.url) return null;

  const baseUrl = getPublicAssetBaseUrl();
  const absoluteUrl = media.url.startsWith('http') || !baseUrl ? media.url : `${baseUrl}${media.url}`;

  return {
    url: media.url,
    absolute_url: absoluteUrl,
    alternativeText: media.alternativeText || null,
    width: media.width || null,
    height: media.height || null,
    formats: media.formats || null,
  };
};

const sortProductImages = (images: any[] = []) =>
  [...images].sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));

const getPrimaryOrderItemImage = (item: any) => {
  const variantImage = sortProductImages(item.variant?.images).find((entry) => entry?.image)?.image;
  if (variantImage) return normalizeMedia(variantImage);

  const productImage = sortProductImages(item.product?.images).find((entry) => entry?.image)?.image;
  return normalizeMedia(productImage);
};

const mapOrderItemForPublicResponse = (item: any) => {
  const image = getPrimaryOrderItemImage(item);

  return {
    product_name: item.product_name,
    variant_label: item.variant_label || null,
    unit_price: Number(item.unit_price || 0),
    quantity: Number(item.quantity || 0),
    image,
    image_url: image?.absolute_url || image?.url || null,
    imageUrl: image?.absolute_url || image?.url || null,
    thumbnail: image?.absolute_url || image?.url || null,
    images: image ? [image] : [],
    product: item.product
      ? {
          name: item.product.name,
          slug: item.product.slug || null,
          brand: item.product.brand ? { name: item.product.brand.name, slug: item.product.brand.slug || null } : null,
          category: item.product.category ? { name: item.product.category.name, slug: item.product.category.slug || null } : null,
        }
      : null,
    variant: item.variant
      ? {
          label: item.variant.label,
          value: item.variant.value,
        }
      : null,
  };
};

const buildWompiPaymentLinkPayload = (order: any) => {
  const commerceId = `ORDER-${order.tracking_number}`;
  const total = getOrderTotal(order);

  if (total < 0.01) {
    throw new Error('Order total must be at least $0.01');
  }

  return {
    identificadorEnlaceComercio: commerceId,
    monto: Number(total.toFixed(2)),
    nombreProducto: buildWompiProductName(order),
    infoProducto: {
      descripcionProducto: buildWompiProductDescription(order),
    },
    configuracion: {
      urlRedirect: getWompiCustomerRedirectUrl(order),
      urlRetorno: getWompiCustomerReturnUrl(order),
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


const appendQueryParam = (url: URL, key: string, value: unknown) => {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((entry) => appendQueryParam(url, key, entry));
    return;
  }

  url.searchParams.set(key, String(value));
};

const buildWompiReturnUrl = (order: any, query: Record<string, unknown>) => {
  const returnUrl = getConfiguredWompiReturnUrl();
  if (!returnUrl) return undefined;

  try {
    const url = new URL(returnUrl);

    // Keep Wompi's original signed query string so the storefront can validate
    // the redirect with its /api/checkout/wompi/redirect helper instead of
    // getting stuck waiting for order details without the hash/idEnlace/monto values.
    Object.entries(query).forEach(([key, value]) => appendQueryParam(url, key, value));

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

const findOrderByDocumentId = async (strapi: any, documentId: string) => {
  try {
    return await strapi.documents('api::order.order').findOne({
      documentId,
      status: 'published',
      populate: publicOrderPopulate as any,
    });
  } catch {
    return null;
  }
};

const findOrderByTrackingNumber = async (strapi: any, trackingNumber: string) => {
  const orders = await strapi.documents('api::order.order').findMany({
    filters: { tracking_number: trackingNumber },
    status: 'published',
    limit: 1,
    populate: publicOrderPopulate as any,
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
        status: 'published',
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
      populate: publicOrderPopulate as any,
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
        wompi_transaction_status: getWompiResultLabel(payload.ResultadoTransaccion || payload.resultadoTransaccion),
        wompi_transaction_message: payload.Mensaje || payload.mensaje || '',
        wompi_authorization_code: payload.CodigoAutorizacion || payload.codigoAutorizacion || '',
        wompi_payment_method: getWompiPaymentMethodLabel(payload.FormaPago || payload.formaPago),
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

    const redirectPaymentStatus = getPaymentStatusFromWompiRedirect(query);
    await strapi.documents('api::order.order').update({
      documentId: order.documentId,
      data: {
        payment_status: redirectPaymentStatus,
        wompi_transaction_id: String(query.idTransaccion || ''),
        wompi_transaction_status: getWompiResultLabel(query.resultadoTransaccion || query.ResultadoTransaccion),
        wompi_authorization_code: String(query.codigoAutorizacion || ''),
        wompi_payment_method: getWompiPaymentMethodLabel(query.formaPago),
      },
      status: 'published',
    });

    const updatedOrder = { ...order, payment_status: redirectPaymentStatus, wompi_transaction_id: String(query.idTransaccion || '') };
    const returnUrl = buildWompiReturnUrl(updatedOrder, query);
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

  async findPublic(ctx) {
    const identifier = String(ctx.params.identifier || '').trim();
    if (!identifier) return ctx.badRequest('Order identifier is required');

    const order =
      (await findOrderByDocumentId(strapi, identifier)) ||
      (await findOrderByTrackingNumber(strapi, identifier));

    if (!order) return ctx.notFound('Order not found');
    if (isPublicOrderAccessExpired(order)) {
      ctx.status = 410;
      ctx.body = { error: { message: 'This public order link has expired' } };
      return;
    }

    const subtotal = Number(order.subtotal || 0);
    const shippingCost = Number(order.shipping_cost || 0);

    ctx.body = {
      data: {
        tracking_number: order.tracking_number,
        payment_status: order.payment_status,
        wompi_transaction_id: order.wompi_transaction_id || null,
        wompi_transaction_status: order.wompi_transaction_status || null,
        wompi_transaction_message: order.wompi_transaction_message || null,
        wompi_authorization_code: order.wompi_authorization_code || null,
        wompi_payment_method: order.wompi_payment_method || null,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        delivery_type: order.delivery_type,
        address: order.address || null,
        subtotal,
        shipping_cost: shippingCost,
        total: Number((subtotal + shippingCost).toFixed(2)),
        public_access_expires_at: new Date(getPublicOrderAccessExpiresAt(order)).toISOString(),
        branch: order.branch ? { name: order.branch.name, address: order.branch.address } : null,
        shipping_rate: order.shipping_rate ? { name: order.shipping_rate.name } : null,
        items: (order.items || []).map(mapOrderItemForPublicResponse),
      },
    };
  },
}));