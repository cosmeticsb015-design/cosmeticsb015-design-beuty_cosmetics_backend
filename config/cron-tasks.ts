const releaseExpiredPaymentReservations = async ({ strapi }: { strapi: any }) => {
  const expiredOrders = await strapi.documents('api::order.order').findMany({
    filters: {
      payment_status: 'pending',
      stock_released: false,
      payment_reservation_expires_at: { $lt: new Date().toISOString() },
    },
    populate: { items: { populate: { branch_stock: true } } },
    status: 'published',
    limit: 100,
  });

  for (const order of expiredOrders) {
    const claimedRows = await strapi.db
      .connection('orders')
      .where({ id: order.id })
      .where({ payment_status: 'pending' })
      .where((builder: any) => builder.where({ stock_released: false }).orWhereNull('stock_released'))
      .update({
        stock_released: true,
        payment_status: 'failed',
        internal_payment_status: 'failed',
        wompi_payment_status: 'failed',
      });

    if (Number(claimedRows) === 0) continue;

    await Promise.all(
      (order.items || []).map((item: any) => {
        const branchStockId = item.branch_stock?.id;
        const quantity = Number(item.quantity || 0);
        if (!branchStockId || quantity <= 0) return Promise.resolve();

        return strapi.db
          .connection('branch_stocks')
          .where({ id: branchStockId })
          .where('reserved', '>=', quantity)
          .decrement('reserved', quantity);
      }),
    );
  }
};

export default {
  releaseExpiredPaymentReservations: {
    task: releaseExpiredPaymentReservations,
    options: {
      rule: '*/5 * * * *',
    },
  },
};
