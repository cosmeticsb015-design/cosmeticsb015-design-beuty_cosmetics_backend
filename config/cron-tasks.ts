const releaseExpiredPaymentReservations = async ({ strapi }: { strapi: any }) => {
  const expiredAttempts = await strapi.documents('api::payment-attempt.payment-attempt').findMany({
    filters: {
      status: 'pending',
      expires_at: { $lt: new Date().toISOString() },
    },
    status: 'published',
    limit: 100,
  });

  for (const attempt of expiredAttempts) {
    await strapi.db
      .connection('payment_attempts')
      .where({ id: attempt.id })
      .where({ status: 'pending' })
      .update({
        status: 'expired',
        wompi_payment_status: 'failed',
      });
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
