import { factories } from '@strapi/strapi';

// Router por defecto (sin auth:false): el admin lo gestiona vía Content Manager
// con su propio JWT. NO le otorgues permisos al rol "Public" para find/findOne
// aquí — los checkout-attempts contienen PII (nombre, email, teléfono) de
// intentos de pago que pueden no haber sido ni siquiera del cliente real.
export default factories.createCoreRouter('api::checkout-attempt.checkout-attempt');