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
    //'1': 'Puntos',
    //'2': 'Cuotas',
    //'3': 'Bitcoin',
    //'4': 'QuickPay',
  };

  return paymentMethodMap[normalized] || normalized;
};

const getPaymentStatusFromWompiRedirect = (query: Record<string, unknown>) => {
  if (asBoolean(query.esAprobada)) return 'paid';

  const result = getWompiResultLabel(query.resultadoTransaccion || query.ResultadoTransaccion).toLowerCase();
  if (['exitosadeclinada', 'fallida'].includes(result)) return 'failed';

  return 'pending';
};

const normalizeWompiTransactionDetails = (transaction: any = {}) => ({
  wompi_transaction_id: String(transaction.idTransaccion || transaction.IdTransaccion || ''),
  wompi_transaction_status: getWompiResultLabel(transaction.resultadoTransaccion || transaction.ResultadoTransaccion),
  wompi_transaction_message: transaction.mensaje || transaction.Mensaje || '',
  wompi_authorization_code: transaction.codigoAutorizacion || transaction.CodigoAutorizacion || '',
  wompi_payment_method: getWompiPaymentMethodLabel(
    transaction.formaPago || transaction.FormaPago || transaction.formaPagoUtilizada || transaction.FormaPagoUtilizada,
  ),
});

const getPaymentStatusFromWompiTransaction = (transaction: any, fallback: 'pending' | 'paid' | 'failed') => {
  if (!transaction) return fallback;
  if (transaction.esAprobada === true || transaction.EsAprobada === true) return 'paid';

  const result = getWompiResultLabel(transaction.resultadoTransaccion || transaction.ResultadoTransaccion).toLowerCase();
  if (['exitosadeclinada', 'fallida'].includes(result)) return 'failed';

  return fallback;
};

const fetchWompiTransactionDetails = async (strapi: any, transactionId: string) => {
  if (!transactionId) return null;

  try {
    return await strapi.service('api::order.wompi').getTransaction(transactionId);
  } catch (error) {
    strapi.log.warn(`Unable to fetch Wompi transaction ${transactionId}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
};

const getOrderTotal = (order: any) => Number(order.subtotal || 0) + Number(order.shipping_cost || 0);

type OrderItemInput = {
  branch_stock?: string;
  branchStock?: string;
  branch_stock_id?: string;
  branchStockId?: string;
  quantity?: number;
};

const generateTrackingNumber = () => `BC-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;

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

const getCheckoutAttemptId = (ctx: any, payload: Record<string, unknown>) => {
  const value =
    payload.checkout_attempt_id ||
    payload.checkoutAttemptId ||
    payload.idempotency_key ||
    payload.idempotencyKey ||
    ctx.get('idempotency-key') ||
    ctx.get('x-idempotency-key');

  const normalized = String(value || '').trim();
  return normalized || undefined;
};

const isUniqueConstraintError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /unique|duplicate/i.test(message);
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

const getCheckoutLineItems = (checkout: any) =>
  Array.isArray(checkout.items) && checkout.items.length > 0
    ? checkout.items
    : Array.isArray(checkout.items_snapshot)
      ? checkout.items_snapshot
      : [];

const buildWompiProductName = (order: any) => {
  const items = getCheckoutLineItems(order);
  if (items.length === 0) return `Orden ${order.tracking_number}`;

  const joined = items.map(formatOrderItemLabel).join(', ');
  if (joined.length <= WOMPI_PRODUCT_NAME_MAX_LENGTH) return joined;

  return `${joined.slice(0, WOMPI_PRODUCT_NAME_MAX_LENGTH - 1)}…`;
};

const buildWompiProductDescription = (order: any) => {
  const items = getCheckoutLineItems(order);
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
  const commerceId = `${order.status ? 'ATTEMPT' : 'ORDER'}-${order.tracking_number}`;
  const total = getOrderTotal(order);

  if (total < 0.01) {
    throw new Error('Order total must be at least $0.01');
  }

  return {
    identificadorEnlaceComercio: commerceId,
    monto: Number(total.toFixed(2)),
    nombreProducto: buildWompiProductName(order),
    formaPago: {
      permitirTarjetaCreditoDebido: true,
      // permitirPagoConPuntoAgricola: false,
      // permitirPagoEnBitcoin: false,
      // permitirPagoEnCuotasAgricola: false,
      // permitePagoQuickPay: false,
    },
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
    datosAdicionales: order.status
      ? { paymentAttemptDocumentId: order.documentId, attemptId: order.attempt_id, trackingNumber: order.tracking_number }
      : { orderDocumentId: order.documentId, trackingNumber: order.tracking_number },
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

  await (strapi.documents as any)(order.status ? 'api::payment-attempt.payment-attempt' : 'api::order.order').update({
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
  const trackingNumber = commerceId.replace(/^(ORDER|ATTEMPT|CHECKOUT)-/, '');

  // IMPORTANTE: api::payment-attempt.payment-attempt tiene draftAndPublish
  // deshabilitado (ver schema.json). Pasar `status: 'published'` a
  // findMany/findOne sobre un content-type sin draftAndPublish hace que
  // Strapi devuelva 0 resultados aunque el registro exista, porque no hay
  // un publishedAt "real" que filtrar. Por eso aquí NO se pasa `status`.
  const attempts = await (strapi.documents as any)('api::payment-attempt.payment-attempt').findMany({
    filters: { tracking_number: trackingNumber },
    limit: 1,
    populate: { order: true },
  });

  if (attempts[0]) return attempts[0];

  // Fallback: si el intento ya fue promovido y por cualquier razón ya no
  // calza por tracking_number (ej. datos inconsistentes), intenta ubicar
  // directamente la Order ya creada con ese mismo tracking_number.
  const promotedOrder = await findOrderByTrackingNumber(strapi, trackingNumber);
  return promotedOrder ? { ...promotedOrder, status: 'promoted', order: promotedOrder } : undefined;
};

const findOrderByDocumentId = async (strapi: any, documentId: string) => {
  try {
    return await strapi.documents('api::order.order').findOne({
      documentId,
      populate: publicOrderPopulate as any,
    });
  } catch {
    return null;
  }
};

const findOrderByTrackingNumber = async (strapi: any, trackingNumber: string) => {
  const orders = await strapi.documents('api::order.order').findMany({
    filters: { tracking_number: trackingNumber },
    limit: 1,
    populate: publicOrderPopulate as any,
  });

  return orders[0];
};

const findAttemptByCheckoutAttemptId = async (strapi: any, checkoutAttemptId: string) => {
  const attempts = await (strapi.documents as any)('api::payment-attempt.payment-attempt').findMany({
    filters: { attempt_id: checkoutAttemptId },
    limit: 1,
    populate: { order: true },
  });

  return attempts[0];
};

const findAttemptByDocumentId = async (strapi: any, documentId: string) => {
  try {
    return await (strapi.documents as any)('api::payment-attempt.payment-attempt').findOne({
      documentId,
      populate: { order: true, branch: true, shipping_rate: true },
    });
  } catch {
    return null;
  }
};

const findAttemptByTrackingNumber = async (strapi: any, trackingNumber: string) => {
  const attempts = await (strapi.documents as any)('api::payment-attempt.payment-attempt').findMany({
    filters: { tracking_number: trackingNumber },
    limit: 1,
    populate: { order: true, branch: true, shipping_rate: true },
  });

  return attempts[0];
};

const findCheckoutSubjectForPaymentLink = async (strapi: any, identifier: string) => {
  const order = await findOrderByDocumentId(strapi, identifier);
  if (order) return { kind: 'order' as const, entity: order };

  const attemptByDocumentId = await findAttemptByDocumentId(strapi, identifier);
  if (attemptByDocumentId) return { kind: 'attempt' as const, entity: attemptByDocumentId };

  const attemptByTrackingNumber = await findAttemptByTrackingNumber(strapi, identifier);
  if (attemptByTrackingNumber) return { kind: 'attempt' as const, entity: attemptByTrackingNumber };

  const attemptByCheckoutAttemptId = await findAttemptByCheckoutAttemptId(strapi, identifier);
  if (attemptByCheckoutAttemptId) return { kind: 'attempt' as const, entity: attemptByCheckoutAttemptId };

  return null;
};

// FIX: cuando el primer intento de pago falló ANTES de obtener un enlace de
// Wompi (ej. el 503 "Unable to authenticate with Wompi"), la orden queda
// marcada payment_status: 'failed' pero conserva su checkout_attempt_id.
// Sin este fix, todo reintento con el mismo checkout_attempt_id (el frontend
// reutiliza el mismo id hasta que el pago tiene éxito) encontraba esa orden
// fallida y respondía 409 para siempre, dejando al cliente sin poder pagar.
// Ahora: si la orden falló y nunca llegó a tener un enlace de Wompi,
// reintentamos generar el enlace para ESA MISMA orden en vez de bloquear.
const respondWithExistingCheckoutAttempt = async (ctx: any, strapi: any, order: any) => {
  if (order.status === 'promoted' && order.order?.documentId) {
    const promotedOrder = await findOrderByDocumentId(strapi, order.order.documentId);
    ctx.status = 200;
    ctx.body = { data: { ...(promotedOrder || order.order), idempotent_replay: true } };
    return;
  }

  const hasPaymentLink = Boolean(order.wompi_payment_link_url || order.wompi_payment_link_long_url);

  if (!hasPaymentLink && order.status === 'failed') {
    try {
      const wompiPayment = await attachWompiPaymentLink(strapi, order);
      ctx.status = 200;
      ctx.body = { data: { ...order, wompi_payment: wompiPayment, idempotent_replay: true } };
      return;
    } catch (error) {
      const message = getWompiErrorMessage(error);
      strapi.log.error('Retry of a previously failed checkout attempt also failed to reach Wompi', error);
      return ctx.internalServerError(`No se pudo crear el enlace de pago de Wompi para la orden: ${message}`);
    }
  }

  if (!hasPaymentLink) {
    // El primer intento sigue genuinamente en curso (no ha fallado ni tiene
    // enlace todavía): aquí sí tiene sentido pedirle al cliente que espere.
    ctx.status = 409;
    ctx.body = { error: { message: 'La orden ya se está procesando. Por favor espera la respuesta del primer intento de pago.' } };
    return;
  }

  const wompiPayment = await attachWompiPaymentLink(strapi, order);
  ctx.status = 200;
  ctx.body = { data: { ...order, wompi_payment: wompiPayment, idempotent_replay: true } };
};

type StockReservation = {
  branchStockId: number;
  documentId: string;
  quantity: number;
};

const reserveStockAtomically = async (strapi: any, stock: any, quantity: number) => {
  const affectedRows = await strapi.db
    .connection('branch_stocks')
    .where({ id: stock.id })
    .whereRaw('COALESCE(quantity, 0) - COALESCE(reserved, 0) >= ?', [quantity])
    .increment('reserved', quantity);

  if (Number(affectedRows) === 0) {
    throw new Error(`Insufficient stock for ${stock.variant?.label || stock.documentId}`);
  }
};

const releaseStockReservations = async (strapi: any, reservations: StockReservation[]) => {
  await Promise.all(
    reservations.map((reservation) =>
      strapi.db
        .connection('branch_stocks')
        .where({ id: reservation.branchStockId })
        .where('reserved', '>=', reservation.quantity)
        .decrement('reserved', reservation.quantity),
    ),
  );
};

const getOrderStockReservations = async (strapi: any, order: any): Promise<StockReservation[]> => {
  const orderWithItems = await strapi.documents('api::order.order').findOne({
    documentId: order.documentId,
    populate: { items: { populate: { branch_stock: true } } },
  });

  return (orderWithItems?.items || [])
    .map((item: any) => ({
      branchStockId: item.branch_stock?.id,
      documentId: item.branch_stock?.documentId,
      quantity: Number(item.quantity || 0),
    }))
    .filter((reservation: StockReservation) => reservation.branchStockId && reservation.documentId && reservation.quantity > 0);
};

const commitStockReservations = async (strapi: any, reservations: StockReservation[]) => {
  for (const reservation of reservations) {
    const affectedRows = await strapi.db
      .connection('branch_stocks')
      .where({ id: reservation.branchStockId })
      .where('reserved', '>=', reservation.quantity)
      .where('quantity', '>=', reservation.quantity)
      .decrement({
        reserved: reservation.quantity,
        quantity: reservation.quantity,
      });

    if (Number(affectedRows) === 0) {
      throw new Error(`Reserved stock is not available for ${reservation.documentId}`);
    }
  }
};

const finalizeStockForPaymentStatus = async (strapi: any, order: any, paymentStatus: 'pending' | 'paid' | 'failed') => {
  if (paymentStatus === 'pending' || order.stock_released || !order.id) return {};

  const claimedRows = await strapi.db
    .connection('orders')
    .where({ id: order.id })
    .where((builder: any) => builder.where({ stock_released: false }).orWhereNull('stock_released'))
    .update({ stock_released: true });

  if (Number(claimedRows) === 0) return {};

  const reservations = await getOrderStockReservations(strapi, order);
  if (paymentStatus === 'paid') {
    await commitStockReservations(strapi, reservations);
  } else {
    await releaseStockReservations(strapi, reservations);
  }

  return {};
};

const markOrderPaymentFailed = async (strapi: any, order: any) => {
  const stockUpdate = await finalizeStockForPaymentStatus(strapi, order, 'failed');

  await strapi.documents('api::order.order').update({
    documentId: order.documentId,
    data: {
      payment_status: 'failed',
      internal_payment_status: 'failed',
      wompi_payment_status: 'failed',
      ...stockUpdate,
    },
    status: 'published',
  });
};

const getAttemptTotal = (attempt: any) => Number(attempt.total || 0) || getOrderTotal(attempt);

const claimAttemptForPromotion = async (strapi: any, attempt: any) => {
  const affectedRows = await strapi.db
    .connection('payment_attempts')
    .where({ id: attempt.id })
    .whereNot({ status: 'promoted' })
    .whereNot({ status: 'promoting' })
    .update({ status: 'promoting' });

  return Number(affectedRows) > 0;
};

const decrementAttemptStock = async (strapi: any, items: any[]) => {
  const decremented: StockReservation[] = [];

  try {
    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      const branchStockDocumentId = item.branch_stock;
      if (!branchStockDocumentId || quantity <= 0) throw new Error('Invalid checkout item stock snapshot');

      const stocks = await strapi.documents('api::branch-stock.branch-stock').findMany({
        filters: { documentId: branchStockDocumentId },
        limit: 1,
      });
      const stock = stocks[0];
      if (!stock?.id) throw new Error(`Branch stock ${branchStockDocumentId} was not found`);

      const affectedRows = await strapi.db
        .connection('branch_stocks')
        .where({ id: stock.id })
        .whereRaw('COALESCE(quantity, 0) >= ?', [quantity])
        .decrement('quantity', quantity);

      if (Number(affectedRows) === 0) throw new Error(`Insufficient stock for ${branchStockDocumentId}`);
      decremented.push({ branchStockId: stock.id, documentId: branchStockDocumentId, quantity });
    }
  } catch (error) {
    await Promise.all(
      decremented.map((entry) =>
        strapi.db.connection('branch_stocks').where({ id: entry.branchStockId }).increment('quantity', entry.quantity),
      ),
    );
    throw error;
  }

  return decremented;
};

const createOrderFromAttempt = async (strapi: any, attempt: any, paymentStatusData: Record<string, unknown>) => {
  const items = Array.isArray(attempt.items_snapshot) ? attempt.items_snapshot : [];
  if (items.length === 0) throw new Error('Payment attempt has no item snapshot');

  const decrementedStock = await decrementAttemptStock(strapi, items);
  let order;

  try {
    order = await strapi.documents('api::order.order').create({
      data: {
        tracking_number: attempt.tracking_number,
        checkout_attempt_id: attempt.attempt_id || attempt.documentId,
        customer_name: attempt.customer_name,
        customer_email: attempt.customer_email,
        customer_phone: attempt.customer_phone,
        delivery_type: attempt.delivery_type,
        address: attempt.address,
        subtotal: Number(Number(attempt.subtotal || 0).toFixed(2)),
        shipping_cost: Number(Number(attempt.shipping_cost || 0).toFixed(2)),
        total: Number(getAttemptTotal(attempt).toFixed(2)),
        order_status: 'pending_shipping',
        fulfillment_status: 'pending_shipping',
        payment_status: 'paid',
        internal_payment_status: 'paid',
        wompi_payment_status: 'paid',
        expires_at: attempt.expires_at || defaultExpiresAt(),
        payment_reservation_expires_at: attempt.expires_at || defaultExpiresAt(),
        stock_released: true,
        stock_decremented: true,
        branch: getRelationDocumentId(attempt.branch),
        shipping_rate: getRelationDocumentId(attempt.shipping_rate),
        wompi_payment_link_id: attempt.wompi_payment_link_id,
        wompi_payment_link_url: attempt.wompi_payment_link_url,
        wompi_payment_link_long_url: attempt.wompi_payment_link_long_url,
        wompi_payment_link_qr_url: attempt.wompi_payment_link_qr_url,
        ...paymentStatusData,
      },
      status: 'published',
    });

    for (const item of items) {
      await strapi.documents('api::order-item.order-item').create({
        data: {
          product_name: item.product_name,
          variant_label: item.variant_label,
          unit_price: Number(Number(item.unit_price || 0).toFixed(2)),
          quantity: Number(item.quantity || 0),
          order: order.documentId,
          product: item.product,
          variant: item.variant,
          branch_stock: item.branch_stock,
        },
        status: 'published',
      });
    }
  } catch (error) {
    await Promise.all(
      decrementedStock.map((entry) =>
        strapi.db.connection('branch_stocks').where({ id: entry.branchStockId }).increment('quantity', entry.quantity),
      ),
    );
    throw error;
  }

  await (strapi.documents as any)('api::payment-attempt.payment-attempt').update({
    documentId: attempt.documentId,
    data: {
      status: 'promoted',
      wompi_payment_status: 'paid',
      order: order.documentId,
      promoted_at: new Date().toISOString(),
      promotion_error: null,
    } as any,
    status: 'published',
  });

  try {
    await strapi.service('api::order.order-email').sendNewOrderAdminEmailOnce(order.documentId);
    await strapi.service('api::order.order-email').sendOrderStatusEmailOnce(order.documentId, 'pending_shipping');
  } catch (emailError) {
    strapi.log.warn(`Unable to send paid order notification email: ${emailError instanceof Error ? emailError.message : emailError}`);
  }

  return order;
};

const promoteApprovedAttemptToOrder = async (strapi: any, attempt: any, paymentStatusData: Record<string, unknown>) => {
  if (attempt.status === 'promoted' && attempt.order?.documentId) {
    return findOrderByDocumentId(strapi, attempt.order.documentId);
  }

  const claimed = await claimAttemptForPromotion(strapi, attempt);
  if (!claimed) {
    const refreshedAttempt = await findAttemptByDocumentId(strapi, attempt.documentId);
    if (refreshedAttempt?.order?.documentId) return findOrderByDocumentId(strapi, refreshedAttempt.order.documentId);
    return null;
  }

  try {
    return await createOrderFromAttempt(strapi, attempt, paymentStatusData);
  } catch (error) {
    await (strapi.documents as any)('api::payment-attempt.payment-attempt').update({
      documentId: attempt.documentId,
      data: {
        status: 'approved',
        wompi_payment_status: 'paid',
        promotion_error: error instanceof Error ? error.message : String(error),
      } as any,
      status: 'published',
    });
    throw error;
  }
};

const buildPublicAttemptResponse = (attempt: any) => {
  const subtotal = Number(attempt.subtotal || 0);
  const shippingCost = Number(attempt.shipping_cost || 0);
  const status = attempt.status === 'promoted' ? 'paid' : attempt.status === 'failed' || attempt.status === 'expired' ? 'failed' : 'pending';

  return {
    kind: 'payment_attempt',
    is_payment_attempt: true,
    tracking_number: attempt.tracking_number,
    payment_status: attempt.wompi_payment_status || status,
    internal_payment_status: status,
    wompi_payment_status: attempt.wompi_payment_status || null,
    wompi_transaction_id: attempt.wompi_transaction_id || null,
    wompi_transaction_status: attempt.wompi_transaction_status || null,
    wompi_transaction_message: attempt.wompi_transaction_message || null,
    wompi_authorization_code: attempt.wompi_authorization_code || null,
    wompi_payment_method: attempt.wompi_payment_method || null,
    customer_name: attempt.customer_name,
    customer_email: attempt.customer_email,
    delivery_type: attempt.delivery_type,
    address: attempt.address || null,
    subtotal,
    shipping_cost: shippingCost,
    total: Number((subtotal + shippingCost).toFixed(2)),
    public_access_expires_at: attempt.expires_at || new Date(getPublicOrderAccessExpiresAt(attempt)).toISOString(),
    branch: attempt.branch ? { name: attempt.branch.name, address: attempt.branch.address } : null,
    shipping_rate: attempt.shipping_rate ? { name: attempt.shipping_rate.name } : null,
    items: (attempt.items_snapshot || []).map((item: any) => ({
      product_name: item.product_name,
      variant_label: item.variant_label || null,
      unit_price: Number(item.unit_price || 0),
      quantity: Number(item.quantity || 0),
      image: null,
      image_url: null,
      imageUrl: null,
      thumbnail: null,
      images: [],
    })),
  };
};

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    const payload = ctx.request.body?.data || ctx.request.body || {};
    const checkoutAttemptId = getCheckoutAttemptId(ctx, payload);

    if (checkoutAttemptId) {
      const existingAttempt = await findAttemptByCheckoutAttemptId(strapi, checkoutAttemptId);
      if (existingAttempt) {
        return respondWithExistingCheckoutAttempt(ctx, strapi, existingAttempt);
      }
    }

    let inputItems: OrderItemInput[];

    try {
      inputItems = normalizeOrderItems(payload.items);
    } catch (error) {
      return ctx.badRequest(error instanceof Error ? error.message : 'Invalid order items');
    }

    const itemsSnapshot: any[] = [];
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
      const available = Number(stock.quantity || 0) - Number(stock.reserved || 0);

      if (available < Number(item.quantity)) {
        return ctx.badRequest(`Insufficient stock for ${stock.variant?.label || item.branch_stock}`);
      }

      const product = stock.variant?.product;
      if (!product) return ctx.badRequest(`Branch stock ${item.branch_stock} is not linked to a product`);

      const unitPrice = Number(stock.variant?.price_override || product.price || 0);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return ctx.badRequest(`Invalid price for ${product.name}`);
      }

      const quantity = Number(item.quantity);
      subtotal += unitPrice * quantity;
      itemsSnapshot.push({
        product_name: product.name,
        variant_label: stock.variant?.label,
        unit_price: Number(unitPrice.toFixed(2)),
        quantity,
        branch_stock: stock.documentId,
        branch_stock_id: stock.id,
        product: product.documentId,
        variant: stock.variant?.documentId,
        branch: stock.branch?.documentId,
      });
    }

    const branchDocumentId = getRelationDocumentId(payload.branch) || itemsSnapshot[0]?.branch;
    const shippingCost = Number(payload.shipping_cost || 0);

    if (!Number.isFinite(shippingCost) || shippingCost < 0) {
      return ctx.badRequest('Shipping cost must be a valid non-negative number');
    }

    let attempt;

    try {
      attempt = await (strapi.documents as any)('api::payment-attempt.payment-attempt').create({
        data: {
          attempt_id: checkoutAttemptId,
          tracking_number: generateTrackingNumber(),
          status: 'pending',
          customer_name: payload.customer_name,
          customer_email: payload.customer_email,
          customer_phone: payload.customer_phone,
          delivery_type: payload.delivery_type,
          address: payload.address,
          subtotal: Number(subtotal.toFixed(2)),
          shipping_cost: Number(shippingCost.toFixed(2)),
          total: Number((subtotal + shippingCost).toFixed(2)),
          expires_at: payload.expires_at || defaultExpiresAt(),
          branch: branchDocumentId,
          shipping_rate: getRelationDocumentId(payload.shipping_rate),
          items_snapshot: itemsSnapshot,
          wompi_payment_status: 'pending',
        },
        status: 'published',
      });
    } catch (error) {
      if (checkoutAttemptId && isUniqueConstraintError(error)) {
        const existingAttempt = await findAttemptByCheckoutAttemptId(strapi, checkoutAttemptId);
        if (existingAttempt) {
          return respondWithExistingCheckoutAttempt(ctx, strapi, existingAttempt);
        }
      }

      throw error;
    }

    try {
      const wompiPayment = await attachWompiPaymentLink(strapi, attempt);
      const createdAttempt = await (strapi.documents as any)('api::payment-attempt.payment-attempt').findOne({
        documentId: attempt.documentId,
        populate: { branch: true, shipping_rate: true },
      });
      ctx.status = 201;
      ctx.body = { data: { ...createdAttempt, payment_status: 'pending', is_payment_attempt: true, wompi_payment: wompiPayment } };
    } catch (error) {
      await (strapi.documents as any)('api::payment-attempt.payment-attempt').update({
        documentId: attempt.documentId,
        data: { status: 'failed', wompi_payment_status: 'failed', promotion_error: getWompiErrorMessage(error) } as any,
        status: 'published',
      });
      const message = getWompiErrorMessage(error);
      strapi.log.error('Unable to create Wompi payment link for checkout attempt', error);
      return ctx.internalServerError(`No se pudo crear el enlace de pago de Wompi para la orden: ${message}`);
    }
  },

  async createWompiPaymentLink(ctx) {
    const identifier =
      ctx.params.id ||
      ctx.request.body?.id ||
      ctx.request.body?.order ||
      ctx.request.body?.orderId ||
      ctx.request.body?.orderDocumentId ||
      ctx.request.body?.attempt ||
      ctx.request.body?.attemptId ||
      ctx.request.body?.attemptDocumentId ||
      ctx.request.body?.checkoutAttemptId ||
      ctx.request.body?.tracking_number;

    if (!identifier) {
      if (Array.isArray(ctx.request.body?.items) && ctx.request.body.items.length > 0) {
        return (strapi.controller('api::order.order') as any).create(ctx);
      }

      return ctx.badRequest('Checkout attempt identifier is required');
    }

    const checkoutSubject = await findCheckoutSubjectForPaymentLink(strapi, String(identifier));

    if (!checkoutSubject) {
      if (Array.isArray(ctx.request.body?.items) && ctx.request.body.items.length > 0) {
        return (strapi.controller('api::order.order') as any).create(ctx);
      }

      return ctx.notFound('Checkout attempt not found');
    }

    const { kind, entity } = checkoutSubject;

    if (kind === 'order') {
      if (entity.payment_status === 'paid') return ctx.badRequest('Order is already paid');
      if (isPublicOrderAccessExpired(entity)) return ctx.badRequest('Order payment link has expired');
    } else {
      if (entity.status === 'promoted' && entity.order?.documentId) {
        ctx.body = { data: { order: entity.order.documentId, attempt: entity.documentId, payment_status: 'paid' } };
        return;
      }

      if (entity.status === 'expired') return ctx.badRequest('Checkout attempt has expired');
      if (entity.status === 'failed' && (entity.wompi_payment_link_url || entity.wompi_payment_link_long_url)) {
        return ctx.badRequest('Checkout attempt has failed. Please create a new checkout attempt.');
      }
      if (isPublicOrderAccessExpired(entity)) return ctx.badRequest('Checkout attempt payment link has expired');
    }

    try {
      const wompiPayment = await attachWompiPaymentLink(strapi, entity);
      ctx.body = {
        data: {
          [kind]: entity.documentId,
          is_payment_attempt: kind === 'attempt',
          payment_status: kind === 'attempt' ? 'pending' : entity.payment_status,
          ...wompiPayment,
        },
      };
    } catch (error) {
      const message = getWompiErrorMessage(error);
      if (message.includes('at least')) return ctx.badRequest(message);
      strapi.log.error('Unable to create Wompi payment link for checkout subject', error);
      return ctx.internalServerError(`No se pudo crear el enlace de pago de Wompi para la orden: ${message}`);
    }
  },

  async wompiWebhook(ctx) {
    const secret = requiredEnv('WOMPI_CLIENT_SECRET');
    const providedHash = String(ctx.get('wompi_hash') || '');
    const rawBody = ctx.request.body?.[unparsedBody];
    const bodyForHash = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');

    if (!providedHash || !bodyForHash || !safeCompare(hmacSha256(bodyForHash, secret), providedHash)) {
      const computedHash = bodyForHash ? hmacSha256(bodyForHash, secret) : '(sin body)';
      strapi.log.warn(
        `Invalid Wompi webhook signature from ${ctx.ip || ctx.request.ip || 'unknown'}. ` +
          `providedHash="${providedHash || '(vacío)'}" computedHash="${computedHash}" ` +
          `bodyLength=${bodyForHash.length} bodyPreview="${bodyForHash.slice(0, 200)}"`,
      );
      return ctx.unauthorized('Invalid Wompi webhook signature');
    }

    const payload = ctx.request.body || {};
    // El payload REAL de Wompi anida identificadorEnlaceComercio dentro de
    // "EnlacePago" (ver https://docs.wompi.sv/webhook/definicion-webhook).
    // Se mantienen los campos planos como fallback por si Wompi envía otro
    // tipo de evento con estructura distinta.
    const enlacePago = payload.EnlacePago || payload.enlacePago || {};
    const commerceId =
      enlacePago.IdentificadorEnlaceComercio ||
      enlacePago.identificadorEnlaceComercio ||
      payload.IdentificadorEnlaceComercio ||
      payload.identificadorEnlaceComercio;
    const transactionId = payload.IdTransaccion || payload.idTransaccion;
    const isApproved = payload.ResultadoTransaccion === 'ExitosaAprobada' || payload.esAprobada === true;

    if (!commerceId || !transactionId) {
      strapi.log.error(
        `Wompi webhook: faltan identificadores en el payload. Llaves recibidas en la raíz: ${Object.keys(payload).join(', ')}. ` +
          `Llaves recibidas en EnlacePago: ${Object.keys(enlacePago).join(', ')}.`,
      );
      return ctx.badRequest('Missing Wompi transaction identifiers');
    }

    const attempt = await findOrderByCommerceId(strapi, commerceId);
    if (!attempt) {
      strapi.log.error(
        `Wompi webhook: no se encontró ningún payment-attempt ni order para identificadorEnlaceComercio="${commerceId}" (tracking_number derivado="${String(commerceId).replace(/^(ORDER|ATTEMPT|CHECKOUT)-/, '')}"). idTransaccion="${transactionId}"`,
      );
      return ctx.notFound('Payment attempt not found for Wompi transaction');
    }

    const expectedTotal = getAttemptTotal(attempt);
    const receivedTotal = asNumber(payload.Monto || payload.monto);
    const paid = isApproved && Math.abs(expectedTotal - receivedTotal) < 0.01;
    const webhookPaymentStatus = paid ? 'paid' : 'failed';
    const paymentStatusData = {
      payment_status: webhookPaymentStatus,
      internal_payment_status: webhookPaymentStatus,
      wompi_payment_status: webhookPaymentStatus,
      wompi_transaction_id: String(transactionId),
      wompi_transaction_status: getWompiResultLabel(payload.ResultadoTransaccion || payload.resultadoTransaccion),
      wompi_transaction_message: payload.Mensaje || payload.mensaje || '',
      wompi_authorization_code: payload.CodigoAutorizacion || payload.codigoAutorizacion || '',
      wompi_payment_method: getWompiPaymentMethodLabel(payload.FormaPago || payload.formaPago || payload.FormaPagoUtilizada || payload.formaPagoUtilizada),
    };

    await (strapi.documents as any)('api::payment-attempt.payment-attempt').update({
      documentId: attempt.documentId,
      data: {
        status: paid ? 'approved' : 'failed',
        ...paymentStatusData,
        raw_wompi_webhook_payload: payload,
      } as any,
      status: 'published',
    });

    if (paid) {
      try {
        await promoteApprovedAttemptToOrder(strapi, { ...attempt, ...paymentStatusData, status: 'approved' }, paymentStatusData);
      } catch (error) {
        strapi.log.error('Unable to promote approved Wompi payment attempt to order', error);
      }
    }

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
      strapi.log.warn(`Invalid Wompi redirect signature from ${ctx.ip || ctx.request.ip || 'unknown'}`);
      return ctx.unauthorized('Invalid Wompi redirect signature');
    }

    const commerceIdFromQuery = String(query.identificadorEnlaceComercio || '');
    const attempt = await findOrderByCommerceId(strapi, commerceIdFromQuery);

    if (!attempt) {
      strapi.log.error(
        `Wompi redirect: no se encontró ningún payment-attempt ni order para identificadorEnlaceComercio="${commerceIdFromQuery}" (tracking_number derivado="${commerceIdFromQuery.replace(/^(ORDER|ATTEMPT|CHECKOUT)-/, '')}"). idTransaccion="${query.idTransaccion || ''}"`,
      );

      // En vez de dejar al cliente viendo un JSON crudo después de haber
      // pagado, lo regresamos al storefront con un estado claro para que
      // pueda contactar soporte con el número de seguimiento a la mano.
      const fallbackReturnUrl = getConfiguredWompiReturnUrl();
      if (fallbackReturnUrl) {
        try {
          const url = new URL(fallbackReturnUrl);
          url.searchParams.set('tracking_number', commerceIdFromQuery.replace(/^(ORDER|ATTEMPT|CHECKOUT)-/, ''));
          url.searchParams.set('payment_status', 'unknown');
          url.searchParams.set('transaction_id', String(query.idTransaccion || ''));
          return ctx.redirect(url.toString());
        } catch {
          // si la URL de retorno configurada es inválida, cae al notFound de abajo
        }
      }

      return ctx.notFound('Checkout attempt not found for Wompi redirect');
    }

    const transactionId = String(query.idTransaccion || '');
    const transaction = await fetchWompiTransactionDetails(strapi, transactionId);
    const redirectPaymentStatus = getPaymentStatusFromWompiTransaction(transaction, getPaymentStatusFromWompiRedirect(query));
    const transactionDetails = normalizeWompiTransactionDetails(transaction || {});
    const paymentStatusData = {
      payment_status: redirectPaymentStatus,
      internal_payment_status: redirectPaymentStatus,
      wompi_payment_status: redirectPaymentStatus,
      wompi_transaction_id: transactionDetails.wompi_transaction_id || transactionId,
      wompi_transaction_status: transactionDetails.wompi_transaction_status,
      wompi_transaction_message: transactionDetails.wompi_transaction_message,
      wompi_authorization_code: transactionDetails.wompi_authorization_code,
      wompi_payment_method: transactionDetails.wompi_payment_method,
    };

    await (strapi.documents as any)('api::payment-attempt.payment-attempt').update({
      documentId: attempt.documentId,
      data: {
        status: redirectPaymentStatus === 'paid' ? 'approved' : redirectPaymentStatus === 'failed' ? 'failed' : 'pending',
        ...paymentStatusData,
        raw_wompi_redirect_payload: query,
      } as any,
      status: 'published',
    });

    let order = null;
    if (redirectPaymentStatus === 'paid') {
      try {
        order = await promoteApprovedAttemptToOrder(strapi, { ...attempt, ...paymentStatusData, status: 'approved' }, paymentStatusData);
      } catch (error) {
        strapi.log.error('Unable to promote approved Wompi redirect attempt to order', error);
      }
    } else if (attempt.status === 'promoted' && attempt.order?.documentId) {
      order = await findOrderByDocumentId(strapi, attempt.order.documentId);
    }

    const redirectSubject = order || { ...attempt, payment_status: redirectPaymentStatus };
    const returnUrl = buildWompiReturnUrl(redirectSubject, query);
    if (returnUrl) {
      try {
        const url = new URL(returnUrl);
        url.searchParams.set('attempt', attempt.documentId);
        if (order?.documentId) url.searchParams.set('order', order.documentId);
        return ctx.redirect(url.toString());
      } catch {
        return ctx.redirect(returnUrl);
      }
    }

    ctx.body = {
      data: {
        order: order?.documentId || null,
        attempt: attempt.documentId,
        payment_status: redirectPaymentStatus,
        transaction_id: query.idTransaccion,
        approved: asBoolean(query.esAprobada),
      },
    };
  },

  async findPublic(ctx) {
    const identifier = String(ctx.params.identifier || '').trim();
    if (!identifier) return ctx.badRequest('Order identifier is required');

    let order =
      (await findOrderByDocumentId(strapi, identifier)) ||
      (await findOrderByTrackingNumber(strapi, identifier));

    if (!order) {
      const attempt =
        (await findAttemptByDocumentId(strapi, identifier)) ||
        (await findAttemptByTrackingNumber(strapi, identifier));

      if (!attempt) return ctx.notFound('Order not found');
      if (attempt.status === 'promoted' && attempt.order?.documentId) {
        const promotedOrder = await findOrderByDocumentId(strapi, attempt.order.documentId);
        if (promotedOrder) {
          ctx.params.identifier = promotedOrder.documentId;
          order = promotedOrder;
        }
      }

      if (!order) {
        const expiresAt = attempt.expires_at ? Date.parse(attempt.expires_at) : Number.NaN;
        if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
          ctx.status = 410;
          ctx.body = { error: { message: 'This public checkout link has expired' }, data: buildPublicAttemptResponse({ ...attempt, status: 'expired' }) };
          return;
        }

        ctx.body = { data: buildPublicAttemptResponse(attempt) };
        return;
      }
    }
    if (isPublicOrderAccessExpired(order)) {
      ctx.status = 410;
      ctx.body = { error: { message: 'This public order link has expired' } };
      return;
    }

    const subtotal = Number(order.subtotal || 0);
    const shippingCost = Number(order.shipping_cost || 0);
    const publicPaymentStatus =
      order.wompi_payment_status ||
      (String(order.wompi_transaction_status || '').toLowerCase() === 'exitosaaprobada' ? 'paid' : order.payment_status);

    ctx.body = {
      data: {
        tracking_number: order.tracking_number,
        payment_status: publicPaymentStatus,
        internal_payment_status: order.payment_status,
        wompi_payment_status: order.wompi_payment_status || null,
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

// ---------------------------------------------------------------------------
// Reconciliación activa de pagos pendientes con Wompi
// ---------------------------------------------------------------------------
// Por qué existe esto: el webhook de Wompi es "pasivo" (depende de que ellos
// nos avisen) y el redirect depende de que el cliente vuelva al navegador y
// presione "Finalizar". Si el cliente cierra la pestaña justo después de
// pagar, ninguno de los dos dispara, y el payment-attempt se queda
// "pending" para siempre aunque el cobro sí se haya hecho.
//
// Esta función consulta ACTIVAMENTE a Wompi (GET /EnlacePago/:id, ver
// https://docs.wompi.sv/metodos-api/) por cada intento pendiente, y si
// Wompi ya tiene una transacción aprobada asociada a ese enlace, lo promueve
// a orden real exactamente igual que lo haría el webhook o el redirect.
// Se ejecuta desde config/cron-tasks.ts cada minuto.
export const reconcilePendingWompiAttempts = async (strapi: any) => {
  const minAgeMs = 90_000; // dale tiempo al redirect/webhook normal antes de intervenir
  const cutoff = new Date(Date.now() - minAgeMs).toISOString();

  const pendingAttempts = await (strapi.documents as any)('api::payment-attempt.payment-attempt').findMany({
    filters: {
      status: 'pending',
      wompi_payment_link_id: { $notNull: true },
      createdAt: { $lt: cutoff },
    },
    limit: 50,
    populate: { order: true, branch: true, shipping_rate: true },
  });

  if (!pendingAttempts.length) {
    strapi.log.info(`[cron] Reconciliación Wompi: 0 intentos pendientes con más de ${minAgeMs / 1000}s de antigüedad y wompi_payment_link_id asignado.`);
    return;
  }

  strapi.log.info(`[cron] Reconciliación Wompi: ${pendingAttempts.length} intento(s) pendiente(s) por revisar.`);

  let wompi: any;
  try {
    wompi = strapi.service('api::order.wompi');
    strapi.log.info(`[cron] Reconciliación Wompi: servicio obtenido OK (typeof wompi=${typeof wompi}, typeof getPaymentLink=${typeof wompi?.getPaymentLink}).`);
  } catch (serviceError) {
    strapi.log.error('[cron] Reconciliación Wompi: ERROR obteniendo strapi.service(\'api::order.wompi\')', serviceError);
    return;
  }

  for (const attempt of pendingAttempts) {
    strapi.log.info(`[cron] Reconciliación Wompi: entrando al loop para intento ${attempt.documentId} (idEnlace=${attempt.wompi_payment_link_id}).`);
    try {
      strapi.log.info(`[cron] Reconciliación Wompi: llamando a wompi.getPaymentLink(${attempt.wompi_payment_link_id})...`);
      const enlace: any = await wompi.getPaymentLink(attempt.wompi_payment_link_id);
      strapi.log.info(`[cron] Reconciliación Wompi: respuesta recibida de Wompi para intento ${attempt.documentId}.`);
      const transaccion = enlace?.transaccionCompra;

      if (!transaccion || !transaccion.idTransaccion) {
        // El cliente todavía no ha pagado con este enlace; lo deja para la
        // próxima corrida (o para el cron de expiración si ya venció).
        strapi.log.info(`[cron] Reconciliación Wompi: intento ${attempt.documentId} (tracking_number=${attempt.tracking_number}) aún sin transacción asociada en Wompi (idEnlace=${attempt.wompi_payment_link_id}).`);
        continue;
      }

      const expectedTotal = getAttemptTotal(attempt);
      const receivedTotal = asNumber(transaccion.monto ?? transaccion.montoOriginal);
      const isApproved = transaccion.esAprobada === true;
      const paid = isApproved && Math.abs(expectedTotal - receivedTotal) < 0.01;

      const paymentStatusData = {
        payment_status: paid ? 'paid' : 'failed',
        internal_payment_status: paid ? 'paid' : 'failed',
        wompi_payment_status: paid ? 'paid' : 'failed',
        wompi_transaction_id: String(transaccion.idTransaccion),
        wompi_transaction_status: getWompiResultLabel(transaccion.resultadoTransaccion),
        wompi_transaction_message: transaccion.mensaje || '',
        wompi_authorization_code: transaccion.codigoAutorizacion || '',
        wompi_payment_method: getWompiPaymentMethodLabel(transaccion.formaPago),
      };

      await (strapi.documents as any)('api::payment-attempt.payment-attempt').update({
        documentId: attempt.documentId,
        data: {
          status: paid ? 'approved' : 'failed',
          ...paymentStatusData,
          raw_wompi_webhook_payload: { source: 'reconciliation_cron', enlace },
        } as any,
        status: 'published',
      });

      if (paid) {
        try {
          await promoteApprovedAttemptToOrder(strapi, { ...attempt, ...paymentStatusData, status: 'approved' }, paymentStatusData);
          strapi.log.info(`Reconciliación Wompi: payment-attempt ${attempt.documentId} promovido a orden (tracking_number=${attempt.tracking_number}).`);
        } catch (promoteError) {
          strapi.log.error(`Reconciliación Wompi: no se pudo promover el payment-attempt ${attempt.documentId} a orden`, promoteError);
        }
      } else {
        strapi.log.warn(`Reconciliación Wompi: payment-attempt ${attempt.documentId} marcado como fallido (idTransaccion=${transaccion.idTransaccion}).`);
      }
    } catch (error) {
      strapi.log.error(`Reconciliación Wompi: error consultando el enlace de pago ${attempt.wompi_payment_link_id} del intento ${attempt.documentId}`, error);
    }
  }
};