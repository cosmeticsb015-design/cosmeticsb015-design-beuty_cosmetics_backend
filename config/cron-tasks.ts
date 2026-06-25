import { reconcilePendingWompiAttempts } from '../src/features/commerce/order/controllers/order';

const releaseExpiredPaymentReservations = async ({ strapi }: { strapi: any }) => {
  // FIX: api::payment-attempt.payment-attempt tiene draftAndPublish:false.
  // Pasar status:'published' a findMany sobre este content-type hace que
  // Strapi devuelva 0 resultados aunque existan registros que cumplan el
  // filtro (mismo bug raíz que rompía createWompiPaymentLink/wompiWebhook/
  // wompiRedirect). Por eso este cron nunca expiraba nada realmente.
  const expiredAttempts = await strapi.documents('api::payment-attempt.payment-attempt').findMany({
    filters: {
      status: 'pending',
      expires_at: { $lt: new Date().toISOString() },
    },
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

// Red de seguridad: si el webhook de Wompi no llega (ej. aplicativo en modo
// de prueba, problema temporal de red, etc.) y el cliente nunca presiona
// "Finalizar" para volver al sitio, este cron consulta activamente a Wompi
// por cada intento de pago pendiente y promueve a orden real los que ya
// fueron aprobados. Ver reconcilePendingWompiAttempts en
// src/features/commerce/order/controllers/order.ts para el detalle.
const reconcilePendingWompiPayments = async ({ strapi }: { strapi: any }) => {
  try {
    await reconcilePendingWompiAttempts(strapi);
  } catch (error) {
    strapi.log.error('Error ejecutando reconcilePendingWompiAttempts', error);
  }
};

export default {
  releaseExpiredPaymentReservations: {
    task: releaseExpiredPaymentReservations,
    options: {
      rule: '*/5 * * * *',
    },
  },
  reconcilePendingWompiPayments: {
    task: reconcilePendingWompiPayments,
    options: {
      rule: '* * * * *',
    },
  },
};