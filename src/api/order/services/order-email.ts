import { factories } from '@strapi/strapi';

const STATUS_LABELS: Record<string, string> = {
  pending_shipping: 'Pendiente de envío',
  shipped: 'Enviado',
  delivered: 'Entregado',
};

const DEFAULT_ORDER_EMAIL_LOGO_URL = 'https://raw.githubusercontent.com/codemarkdev/clientes-codemar/refs/heads/main/log.png';

const STATUS_MESSAGES: Record<string, string> = {
  pending_shipping: 'Tu pago fue confirmado y estamos preparando tu pedido para envío.',
  shipped: 'Tu pedido ya fue enviado. Pronto estará en camino a tu dirección.',
  delivered: 'Tu pedido fue marcado como entregado. ¡Gracias por comprar en Beauty Cosmetics!',
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const currency = (value: unknown) =>
  new Intl.NumberFormat('es-SV', { style: 'currency', currency: process.env.ORDER_EMAIL_CURRENCY || 'USD' }).format(Number(value || 0));

const getLogoUrl = () => {
  const configured = (process.env.ORDER_EMAIL_LOGO_URL || '').trim();
  if (configured) return configured;

  return DEFAULT_ORDER_EMAIL_LOGO_URL;
};

const normalizeSentMap = (value: any) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const orderPopulate = {
  items: true,
  branch: true,
  shipping_rate: true,
};

const getStoreNotificationEmail = async (strapi: any) => {
  try {
    const storeConfig = await strapi.documents('api::store-config.store-config').findFirst({ status: 'published' });
    return String(storeConfig?.notification_email || '').trim();
  } catch (error) {
    strapi.log.warn(`Unable to read store notification email: ${error instanceof Error ? error.message : error}`);
    return '';
  }
};

const buildItemsRows = (items: any[] = []) =>
  items
    .map((item) => {
      const name = `${escapeHtml(item.product_name)}${item.variant_label ? ` <span style="color:#6b7280;">(${escapeHtml(item.variant_label)})</span>` : ''}`;
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      return `<tr>
        <td style="padding:12px;border-bottom:1px solid #f3d6df;">${name}</td>
        <td style="padding:12px;border-bottom:1px solid #f3d6df;text-align:center;">${quantity}</td>
        <td style="padding:12px;border-bottom:1px solid #f3d6df;text-align:right;">${currency(unitPrice)}</td>
        <td style="padding:12px;border-bottom:1px solid #f3d6df;text-align:right;">${currency(unitPrice * quantity)}</td>
      </tr>`;
    })
    .join('');

const buildNewOrderAdminEmail = (order: any) => {
  const logoUrl = getLogoUrl();
  const subtotal = Number(order.subtotal || 0);
  const shipping = Number(order.shipping_cost || 0);
  const total = Number(order.total || subtotal + shipping);
  const subject = `Nuevo pedido ${order.tracking_number} en Beauty Cosmetics`;
  const logoHtml = `<img src="${escapeHtml(logoUrl)}" alt="Beauty Cosmetics" width="96" style="display:block;margin:0 auto 16px;border-radius:999px;" />`;

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#fff7fb;font-family:Arial,Helvetica,sans-serif;color:#2f2f3a;">
    <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
      <div style="background:#ffffff;border:1px solid #f3d6df;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(207,82,125,.12);">
        <div style="background:#cf527d;padding:28px;text-align:center;color:#fff7d9;">
          ${logoHtml}
          <h1 style="margin:0;font-size:26px;">Nuevo pedido</h1>
          <p style="margin:10px 0 0;font-size:15px;color:#fff7d9;">Pedido ${escapeHtml(order.tracking_number)}</p>
        </div>
        <div style="padding:28px;">
          <p style="font-size:16px;line-height:1.55;margin:0 0 22px;">Se creó un nuevo pedido en Beauty Cosmetics. Revisa el detalle para coordinar pago, preparación y entrega.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:20px 0;border:1px solid #f3d6df;border-radius:14px;overflow:hidden;">
            <thead><tr style="background:#fff0f5;color:#99405f;"><th align="left" style="padding:12px;">Producto</th><th style="padding:12px;">Cant.</th><th align="right" style="padding:12px;">Precio</th><th align="right" style="padding:12px;">Total</th></tr></thead>
            <tbody>${buildItemsRows(order.items || [])}</tbody>
          </table>
          <div style="margin-left:auto;max-width:280px;">
            <p style="display:flex;justify-content:space-between;margin:6px 0;"><span>Subtotal</span><strong>${currency(subtotal)}</strong></p>
            <p style="display:flex;justify-content:space-between;margin:6px 0;"><span>Envío</span><strong>${currency(shipping)}</strong></p>
            <p style="display:flex;justify-content:space-between;margin:12px 0 0;padding-top:12px;border-top:1px solid #f3d6df;font-size:18px;"><span>Total</span><strong>${currency(total)}</strong></p>
          </div>
          <div style="margin-top:24px;padding:16px;background:#fff7fb;border-radius:14px;">
            <p style="margin:0 0 6px;"><strong>Cliente:</strong> ${escapeHtml(order.customer_name)} &lt;${escapeHtml(order.customer_email)}&gt;</p>
            <p style="margin:0 0 6px;"><strong>Teléfono:</strong> ${escapeHtml(order.customer_phone)}</p>
            <p style="margin:0 0 6px;"><strong>Entrega:</strong> ${escapeHtml(order.delivery_type === 'pickup' ? 'Retiro en tienda' : 'Envío a domicilio')}</p>
            ${order.address ? `<p style="margin:0 0 6px;"><strong>Dirección:</strong> ${escapeHtml(order.address)}</p>` : ''}
            ${order.branch?.name ? `<p style="margin:0;"><strong>Sucursal:</strong> ${escapeHtml(order.branch.name)}</p>` : ''}
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const text = `Nuevo pedido ${order.tracking_number}

Cliente: ${order.customer_name} <${order.customer_email}>
Teléfono: ${order.customer_phone || ''}
Entrega: ${order.delivery_type === 'pickup' ? 'Retiro en tienda' : 'Envío a domicilio'}
Total: ${currency(total)}

Detalle:
${(order.items || []).map((item: any) => `- ${item.product_name}${item.variant_label ? ` (${item.variant_label})` : ''} x${item.quantity}: ${currency(Number(item.unit_price || 0) * Number(item.quantity || 0))}`).join('\n')}`;

  return { subject, html, text };
};

const buildOrderStatusEmail = (order: any, status: string) => {
  const logoUrl = getLogoUrl();
  const subtotal = Number(order.subtotal || 0);
  const shipping = Number(order.shipping_cost || 0);
  const total = Number(order.total || subtotal + shipping);
  const statusLabel = STATUS_LABELS[status] || status;
  const subject = `Tu pedido ${order.tracking_number} está ${statusLabel.toLowerCase()}`;
  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="Beauty Cosmetics" width="120" style="display:block;margin:0 auto 18px;border-radius:999px;" />`
    : `<div style="width:120px;height:120px;border-radius:999px;background:#cf527d;color:#fff7d9;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;">BC</div>`;

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#fff7fb;font-family:Arial,Helvetica,sans-serif;color:#2f2f3a;">
    <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
      <div style="background:#ffffff;border:1px solid #f3d6df;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(207,82,125,.12);">
        <div style="background:#cf527d;padding:28px;text-align:center;color:#fff7d9;">
          ${logoHtml}
          <h1 style="margin:0;font-size:26px;">${escapeHtml(statusLabel)}</h1>
          <p style="margin:10px 0 0;font-size:15px;color:#fff7d9;">Pedido ${escapeHtml(order.tracking_number)}</p>
        </div>
        <div style="padding:28px;">
          <p style="font-size:16px;line-height:1.55;margin:0 0 14px;">Hola ${escapeHtml(order.customer_name)},</p>
          <p style="font-size:16px;line-height:1.55;margin:0 0 22px;">${escapeHtml(STATUS_MESSAGES[status] || 'Tenemos una actualización de tu pedido.')}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:20px 0;border:1px solid #f3d6df;border-radius:14px;overflow:hidden;">
            <thead><tr style="background:#fff0f5;color:#99405f;"><th align="left" style="padding:12px;">Producto</th><th style="padding:12px;">Cant.</th><th align="right" style="padding:12px;">Precio</th><th align="right" style="padding:12px;">Total</th></tr></thead>
            <tbody>${buildItemsRows(order.items || [])}</tbody>
          </table>
          <div style="margin-left:auto;max-width:280px;">
            <p style="display:flex;justify-content:space-between;margin:6px 0;"><span>Subtotal</span><strong>${currency(subtotal)}</strong></p>
            <p style="display:flex;justify-content:space-between;margin:6px 0;"><span>Envío</span><strong>${currency(shipping)}</strong></p>
            <p style="display:flex;justify-content:space-between;margin:12px 0 0;padding-top:12px;border-top:1px solid #f3d6df;font-size:18px;"><span>Total</span><strong>${currency(total)}</strong></p>
          </div>
          <div style="margin-top:24px;padding:16px;background:#fff7fb;border-radius:14px;">
            <p style="margin:0 0 6px;"><strong>Cliente:</strong> ${escapeHtml(order.customer_name)} &lt;${escapeHtml(order.customer_email)}&gt;</p>
            <p style="margin:0 0 6px;"><strong>Entrega:</strong> ${escapeHtml(order.delivery_type === 'pickup' ? 'Retiro en tienda' : 'Envío a domicilio')}</p>
            ${order.address ? `<p style="margin:0 0 6px;"><strong>Dirección:</strong> ${escapeHtml(order.address)}</p>` : ''}
            ${order.branch?.name ? `<p style="margin:0;"><strong>Sucursal:</strong> ${escapeHtml(order.branch.name)}</p>` : ''}
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const text = `Hola ${order.customer_name},\n\n${STATUS_MESSAGES[status] || 'Tenemos una actualización de tu pedido.'}\n\nPedido: ${order.tracking_number}\nEstado: ${statusLabel}\nTotal: ${currency(total)}\n\nDetalle:\n${(order.items || []).map((item: any) => `- ${item.product_name}${item.variant_label ? ` (${item.variant_label})` : ''} x${item.quantity}: ${currency(Number(item.unit_price || 0) * Number(item.quantity || 0))}`).join('\n')}`;

  return { subject, html, text };
};

export default factories.createCoreService('api::order.order', ({ strapi }) => ({
  async sendNewOrderAdminEmailOnce(documentId: string) {
    const order = await strapi.documents('api::order.order').findOne({
      documentId,
      status: 'published',
      populate: orderPopulate as any,
    });

    if (!order) return;

    const sentMap = normalizeSentMap((order as any).status_email_sent);
    if (sentMap.admin_new_order) return;

    const notificationEmail = await getStoreNotificationEmail(strapi);
    if (!notificationEmail) return;

    const email = buildNewOrderAdminEmail(order);

    await strapi.plugin('email').service('email').send({
      to: notificationEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    await strapi.documents('api::order.order').update({
      documentId,
      data: {
        status_email_sent: {
          ...sentMap,
          admin_new_order: new Date().toISOString(),
        },
      } as any,
      status: 'published',
    });
  },

  async sendOrderStatusEmailOnce(documentId: string, status: string) {
    if (!STATUS_LABELS[status]) return;

    const order = await strapi.documents('api::order.order').findOne({
      documentId,
      status: 'published',
      populate: orderPopulate as any,
    });

    if (!order || order.payment_status !== 'paid' || !order.customer_email) return;

    const sentMap = normalizeSentMap((order as any).status_email_sent);
    if (sentMap[status]) return;

    const email = buildOrderStatusEmail(order, status);

    await strapi.plugin('email').service('email').send({
      to: order.customer_email,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    await strapi.documents('api::order.order').update({
      documentId,
      data: {
        status_email_sent: {
          ...sentMap,
          [status]: new Date().toISOString(),
        },
      } as any,
      status: 'published',
    });
  },
}));
