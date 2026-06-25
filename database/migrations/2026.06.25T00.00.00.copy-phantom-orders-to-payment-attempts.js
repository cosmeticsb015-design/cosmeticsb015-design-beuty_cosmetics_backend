'use strict';

const crypto = require('node:crypto');

const hasColumn = async (knex, tableName, columnName) =>
  (await knex.schema.hasTable(tableName)) && (await knex.schema.hasColumn(tableName, columnName));

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable('orders')) || !(await knex.schema.hasTable('payment_attempts'))) return;
    if (!(await hasColumn(knex, 'payment_attempts', 'attempt_id'))) return;

    const ghosts = await knex('orders')
      .whereIn('payment_status', ['pending', 'failed'])
      .where((builder) =>
        builder
          .whereNull('wompi_transaction_status')
          .orWhereNot('wompi_transaction_status', 'ExitosaAprobada'),
      )
      .limit(500);

    for (const order of ghosts) {
      const attemptId = order.checkout_attempt_id || `migrated-order-${order.document_id || order.id}`;
      const existing = await knex('payment_attempts').where({ attempt_id: attemptId }).first();
      if (existing) continue;

      const items = (await knex('order_items').where({ order_id: order.id }).catch(() => [])).map((item) => ({
        product_name: item.product_name,
        variant_label: item.variant_label,
        unit_price: Number(item.unit_price || 0),
        quantity: Number(item.quantity || 0),
      }));

      const now = new Date();
      await knex('payment_attempts').insert({
        document_id: crypto.randomBytes(12).toString('hex'),
        attempt_id: attemptId,
        tracking_number: order.tracking_number || `MIGRATED-${order.id}`,
        status: order.payment_status === 'failed' ? 'failed' : 'expired',
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        delivery_type: order.delivery_type,
        address: order.address,
        subtotal: order.subtotal,
        shipping_cost: order.shipping_cost,
        total: order.total,
        expires_at: order.expires_at || order.payment_reservation_expires_at || now,
        items_snapshot: JSON.stringify(items),
        wompi_payment_status: order.wompi_payment_status || order.payment_status,
        wompi_transaction_id: order.wompi_transaction_id,
        wompi_transaction_status: order.wompi_transaction_status,
        wompi_transaction_message: order.wompi_transaction_message,
        wompi_authorization_code: order.wompi_authorization_code,
        wompi_payment_method: order.wompi_payment_method,
        wompi_payment_link_id: order.wompi_payment_link_id,
        wompi_payment_link_url: order.wompi_payment_link_url,
        wompi_payment_link_long_url: order.wompi_payment_link_long_url,
        wompi_payment_link_qr_url: order.wompi_payment_link_qr_url,
        created_at: order.created_at || now,
        updated_at: now,
        published_at: order.published_at || now,
      });
    }
  },

  async down() {},
};
