// Sin cron jobs. Siguiendo la misma filosofía del ejemplo de referencia en
// Laravel: las órdenes se crean ÚNICAMENTE cuando el webhook de Wompi
// confirma el pago (ver wompiWebhook en
// src/features/commerce/order/controllers/order.ts). No existe ningún
// mecanismo de polling/reconciliación activa contra la API de Wompi.
//
// Los payment-attempt que el cliente abandona sin pagar simplemente se
// quedan en estado "pending" en la base de datos — esto es inofensivo:
// nunca reservan ni descuentan inventario (eso solo ocurre al confirmarse
// el pago real), y el enlace de pago de Wompi de todos modos deja de ser
// usable una vez vencido su propio tiempo de vigencia configurado en el
// panel de Wompi.
export default {};