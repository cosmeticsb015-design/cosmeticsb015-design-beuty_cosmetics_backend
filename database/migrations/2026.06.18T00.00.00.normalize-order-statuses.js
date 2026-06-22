'use strict';

const ORDER_STATUS_FALLBACKS = {
  completed: 'delivered',
  cancelled: 'pending_shipping',
};

async function normalizeColumn(knex, columnName) {
  const hasColumn = await knex.schema.hasColumn('orders', columnName);
  if (!hasColumn) return;

  await Promise.all(
    Object.entries(ORDER_STATUS_FALLBACKS).map(([legacyStatus, normalizedStatus]) =>
      knex('orders')
        .where(columnName, legacyStatus)
        .update({ [columnName]: normalizedStatus })
    )
  );
}

module.exports = {
  async up(knex) {
    await normalizeColumn(knex, 'order_status');
    await normalizeColumn(knex, 'fulfillment_status');
  },
};
