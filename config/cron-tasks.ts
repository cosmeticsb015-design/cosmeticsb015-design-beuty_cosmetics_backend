const releaseExpiredCheckoutAttemptReservations = async ({ strapi }: { strapi: any }) => {
  const expiredAttempts = await strapi.documents('api::checkout-attempt.checkout-attempt').findMany({
    filters: {
      payment_status: 'pending',
      stock_released: false,
      payment_reservation_expires_at: { $lt: new Date().toISOString() },
    },
    limit: 100,
  });

  for (const attempt of expiredAttempts) {
    const claimedRows = await strapi.db
      .connection('checkout_attempts')
      .where({ id: attempt.id })
      .where({ payment_status: 'pending' })
      .where((builder: any) => builder.where({ stock_released: false }).orWhereNull('stock_released'))
      .update({
        stock_released: true,
        payment_status: 'expired',
      });

    if (Number(claimedRows) === 0) continue;

    await Promise.all(
      (attempt.items || []).map((item: any) => {
        const branchStockId = item.branch_stock_id;
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
  releaseExpiredCheckoutAttemptReservations: {
    task: releaseExpiredCheckoutAttemptReservations,
    options: {
      rule: '*/5 * * * *',
    },
  },
};