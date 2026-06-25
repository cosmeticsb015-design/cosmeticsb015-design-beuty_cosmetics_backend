/**
 * order controller
 *
 * Ya no maneja pagos ni checkout: una Order solo se crea internamente desde
 * el checkout-attempt controller cuando Wompi confirma el pago. Este
 * controlador queda con el CRUD por defecto (admin / content-manager).
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::order.order');