const releaseExpiredPaymentReservations = async ({ strapi }: { strapi: any }) => {
  // FIX: api::payment-attempt.payment-attempt tiene draftAndPublish:false.
  // Pasar status:'published' a findMany sobre este content-type hace que
  // Strapi devuelva 0 resultados aunque existan registros que cumplan el
  // filtro (mismo bug raíz que rompía createWompiPaymentLink/wompiWebhook/
  // wompiRedirect). Por eso este cron nunca expiraba nada realmente.
  strapi.log.info('[cron] releaseExpiredPaymentReservations: tick');

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
//
// IMPORTANTE: el require() del controlador se hace DENTRO de la tarea, NO
// en el top-level del archivo. config/cron-tasks.ts se carga muy temprano en
// el arranque de Strapi (fase de configuración), antes de que los
// controladores/content-types estén completamente registrados. Importar un
// módulo construido con factories.createCoreController(...) en el top-level
// de un archivo de config puede fallar de forma silenciosa en ese momento y
// dejar el/los cron job(s) sin registrar, sin ningún error visible en los
// logs. Al hacer el require() dentro de la función, este solo se ejecuta
// cuando el cron realmente dispara (mucho después de que Strapi terminó de
// arrancar), evitando el problema por completo.
const reconcilePendingWompiPayments = async ({ strapi }: { strapi: any }) => {
  strapi.log.info('[cron] reconcilePendingWompiPayments: tick');
  try {
    const orderController = require('../src/features/commerce/order/controllers/order');
    const reconcilePendingWompiAttempts = orderController.reconcilePendingWompiAttempts || orderController.default?.reconcilePendingWompiAttempts;

    if (typeof reconcilePendingWompiAttempts !== 'function') {
      strapi.log.error('[cron] No se encontró reconcilePendingWompiAttempts en el controlador de order. Revisa el export.');
      return;
    }

    await reconcilePendingWompiAttempts(strapi);
  } catch (error) {
    strapi.log.error('[cron] Error ejecutando reconcilePendingWompiAttempts', error);
  }
};

// NOTA: reconcilePendingWompiPayments YA NO corre aquí. Se confirmó que el
// scheduler de cron de Strapi (node-schedule) no ejecuta correctamente esta
// tarea en particular al dispararla (el "tick" se loguea bien, pero el
// cuerpo de la función nunca progresa). Se movió a un setInterval simple en
// src/index.ts (bootstrap), que sí funciona de forma confiable.
export default {
  releaseExpiredPaymentReservations: {
    task: releaseExpiredPaymentReservations,
    options: {
      rule: '*/5 * * * *',
    },
  },
};