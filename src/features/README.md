# Arquitectura Gritona

Esta carpeta agrupa los módulos del backend por capacidades de negocio para que la estructura del proyecto comunique claramente el dominio principal de la aplicación.

- `catalog/`: catálogo de productos, marcas, categorías, imágenes y variantes.
- `commerce/`: comercio, órdenes, ítems de orden, tarifas de envío y flujo de pago.
- `locations/`: ubicaciones, sucursales e inventario por sucursal.
- `storefront/`: configuración pública de la tienda.
- `security/`: autenticación y flujos de seguridad específicos de la aplicación.

## Compatibilidad con Strapi

Strapi espera encontrar las APIs en `src/api/<nombre-api>`. Por eso, `src/api` conserva enlaces simbólicos hacia estos módulos de dominio. De esta forma se mantiene el funcionamiento actual y, a la vez, el código queda organizado por contexto de negocio.
