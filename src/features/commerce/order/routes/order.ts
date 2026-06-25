/**
 * order router
 *
 * Ya no expone "create" públicamente: las Orders solo nacen del flujo de
 * pago confirmado (ver checkout-attempt). El core router por defecto
 * (protegido) es suficiente para el admin.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::order.order');