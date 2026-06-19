const EMAILABLE_ORDER_STATUSES = ['pending_shipping', 'shipped', 'delivered'];

const statusChangedInPayload = (data: Record<string, any> = {}) =>
  Object.prototype.hasOwnProperty.call(data, 'order_status') ||
  Object.prototype.hasOwnProperty.call(data, 'fulfillment_status') ||
  Object.prototype.hasOwnProperty.call(data, 'payment_status') ||
  Object.prototype.hasOwnProperty.call(data, 'wompi_payment_status') ||
  Object.prototype.hasOwnProperty.call(data, 'internal_payment_status');

const findPreviousOrder = async (strapi: any, where: Record<string, any>) => {
  const id = where?.id;
  const documentId = where?.documentId;

  if (!id && !documentId) return null;

  const orders = await strapi.documents('api::order.order').findMany({
    filters: id ? { id } : { documentId },
    status: 'published',
    limit: 1,
  });

  return orders[0] || null;
};

export default {
  async beforeUpdate(event: any) {
    if (!statusChangedInPayload(event.params?.data)) return;

    event.state = event.state || {};
    event.state.previousOrder = await findPreviousOrder(strapi, event.params?.where || {});
  },

  async afterUpdate(event: any) {
    if (!statusChangedInPayload(event.params?.data)) return;

    const order = event.result;
    const currentStatus = order?.order_status || order?.fulfillment_status;
    if (!EMAILABLE_ORDER_STATUSES.includes(currentStatus)) return;

    const previousOrder = event.state?.previousOrder;
    const statusWasAlreadyCurrent = previousOrder?.order_status === currentStatus || previousOrder?.fulfillment_status === currentStatus;
    const paymentJustBecamePaid = previousOrder?.payment_status !== 'paid' && order?.payment_status === 'paid';
    const statusChanged = !statusWasAlreadyCurrent;

    if (!statusChanged && !paymentJustBecamePaid) return;

    if (paymentJustBecamePaid) {
      try {
        await strapi.service('api::order.order-email').sendNewOrderAdminEmailOnce(order.documentId);
      } catch (emailError) {
        strapi.log.warn(`Unable to send paid order notification email: ${emailError instanceof Error ? emailError.message : emailError}`);
      }
    }

    await strapi.service('api::order.order-email').sendOrderStatusEmailOnce(order.documentId, currentStatus);
  },
};
