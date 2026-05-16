const crypto = require('crypto');
const pool = require('../db/connection');
const qrService = require('../services/qrService');
const emailService = require('../services/emailService');
const wooService = require('../services/wooService');
const orderProcessingRules = require('../services/orderProcessingRules');
require('dotenv').config();

const webhookController = {
  enviarTicketEnSegundoPlano: (token, ticketData) => {
    setImmediate(async () => {
      try {
        await emailService.enviarTicket(ticketData);
        await pool.query('UPDATE tickets SET email_sent = true WHERE token = ?', [token]);
      } catch (error) {
        console.error(`Error enviando ticket ${ticketData.short_code}:`, error);
      }
    });
  },

  recibirWebhook: async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const payload = req.body;
      const eventType = req.headers['x-wc-webhook-topic'] || 'unknown';
      const orderId = payload.id;

      await connection.query(
        'INSERT INTO webhook_events (order_id, event_type, payload, processed, signature_valid) VALUES (?, ?, ?, false, true)',
        [orderId, eventType, JSON.stringify(payload)]
      );
      console.log(`Webhook recibido: ${eventType} para orden ${orderId}`);

      const decision = orderProcessingRules.shouldProcessOrder(payload);
      if (!decision.allowed) {
        await connection.query(
          'UPDATE webhook_events SET processed = true WHERE order_id = ? AND event_type = ?',
          [orderId, eventType]
        );
        return res.json({ recibido: true, mensaje: 'Orden ignorada por reglas de procesamiento', reason: decision.reason });
      }

      // Caso cancelación
      if (payload.status === 'cancelled') {
        await webhookController.cancelarTicket(connection, orderId, eventType);
        return res.json({ recibido: true, mensaje: 'Ticket cancelado' });
      }

      // Solo procesar órdenes con pago
      if (payload.status !== 'completed' && payload.status !== 'processing') {
        await connection.query(
          'UPDATE webhook_events SET processed = true WHERE order_id = ? AND event_type = ?',
          [orderId, eventType]
        );
        return res.json({ recibido: true, mensaje: 'Estado no válido para ticket', status: payload.status });
      }

      // Verificar si ya existe ticket para esta orden
      const [ticketsExistentes] = await connection.query(
        'SELECT * FROM tickets WHERE order_id = ?',
        [orderId]
      );

      if (ticketsExistentes.length > 0) {
        const ticket = ticketsExistentes[0];

        // Si el ticket está cancelado, reactivarlo
        if (ticket.status === 'cancelled') {
          await webhookController.reactivarTicket(connection, orderId, payload, eventType);
          return res.json({ recibido: true, mensaje: 'Ticket reactivado', ticket: `TKT-${orderId}` });
        }

        // Si está activo o escaneado, no hacer nada
        return res.json({ recibido: true, mensaje: 'Ticket ya existente y activo', ticket: ticket.short_code });
      }

      // Si no existe, crearlo
      await webhookController.crearTicket(connection, payload, eventType);
      res.json({ recibido: true, ticket: `TKT-${orderId}`, mensaje: 'Ticket generado' });
    } catch (error) {
      console.error('Error procesando webhook:', error);
      res.status(500).json({ error: 'Error procesando webhook', message: error.message });
    } finally {
      connection.release();
    }
  },

  // Nueva función para crear ticket (extraída para reutilizar)
  crearTicket: async (connection, orden, eventType) => {
    const orderId = orden.id;
    const ordenData = {
      order_id: orderId,
      email_cliente: orden.billing.email,
      nombre_cliente: `${orden.billing.first_name} ${orden.billing.last_name}`,
      pax: webhookController.extraerPAX(orden),
      productos: webhookController.extraerProductos(orden)
    };

    const tokenData = `${orderId}${process.env.JWT_SECRET}${Date.now()}`;
    const token = crypto.createHash('sha256').update(tokenData).digest('hex');
    const shortCode = `TKT-${orderId}`;

    const qrData = JSON.stringify({ token, short_code: shortCode, order_id: orderId });
    const qrBase64 = await qrService.generarQRBase64(qrData);

    await connection.query(
      'INSERT INTO tickets (order_id, token, short_code, email_cliente, nombre_cliente, pax, productos, status, qr_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ordenData.order_id, token, shortCode, ordenData.email_cliente, ordenData.nombre_cliente, ordenData.pax, JSON.stringify(ordenData.productos), 'active', qrBase64]
    );

    const ticketData = { token, short_code: shortCode, nombre_cliente: ordenData.nombre_cliente, email_cliente: ordenData.email_cliente, pax: ordenData.pax, productos: ordenData.productos, qr_base64: qrBase64 };
    webhookController.enviarTicketEnSegundoPlano(token, ticketData);

    await wooService.actualizarMetadatos(orderId, [
      { key: '_ticket_status', value: 'active' },
      { key: '_ticket_code', value: shortCode },
      { key: '_ticket_generated_date', value: new Date().toISOString() }
    ]);

    await connection.query(
      'UPDATE webhook_events SET processed = true WHERE order_id = ? AND event_type = ?',
      [orderId, eventType]
    );
    console.log(`Ticket creado: ${shortCode}`);
  },

  // Nueva función para reactivar ticket cancelado
  reactivarTicket: async (connection, orderId, orden, eventType) => {
    console.log(`Reactivando ticket cancelado para orden ${orderId}`);

    const ordenData = {
      order_id: orderId,
      email_cliente: orden.billing.email,
      nombre_cliente: `${orden.billing.first_name} ${orden.billing.last_name}`,
      pax: webhookController.extraerPAX(orden),
      productos: webhookController.extraerProductos(orden)
    };

    // Generar nuevo token y QR
    const tokenData = `${orderId}${process.env.JWT_SECRET}${Date.now()}`;
    const token = crypto.createHash('sha256').update(tokenData).digest('hex');
    const shortCode = `TKT-${orderId}`;

    const qrData = JSON.stringify({ token, short_code: shortCode, order_id: orderId });
    const qrBase64 = await qrService.generarQRBase64(qrData);

    // Actualizar el ticket existente (cambiar token, QR, estado a active, etc.)
    await connection.query(
      'UPDATE tickets SET token = ?, qr_code = ?, nombre_cliente = ?, email_cliente = ?, pax = ?, productos = ?, status = ?, scanned_at = NULL, scanned_by = NULL, device_id = NULL WHERE order_id = ?',
      [token, qrBase64, ordenData.nombre_cliente, ordenData.email_cliente, ordenData.pax, JSON.stringify(ordenData.productos), 'active', orderId]
    );

    const ticketData = { token, short_code: shortCode, nombre_cliente: ordenData.nombre_cliente, email_cliente: ordenData.email_cliente, pax: ordenData.pax, productos: ordenData.productos, qr_base64: qrBase64 };
    await connection.query('UPDATE tickets SET email_sent = false, pdf_path = NULL WHERE token = ?', [token]);
    webhookController.enviarTicketEnSegundoPlano(token, ticketData);

    await wooService.actualizarMetadatos(orderId, [
      { key: '_ticket_status', value: 'active' },
      { key: '_ticket_code', value: shortCode },
      { key: '_ticket_reactivated_date', value: new Date().toISOString() }
    ]);

    await connection.query(
      'UPDATE webhook_events SET processed = true WHERE order_id = ? AND event_type = ?',
      [orderId, eventType]
    );
    console.log(`Ticket reactivado: ${shortCode}`);
  },

 cancelarTicket: async (connection, orderId, eventType) => {
  const [tickets] = await connection.query('SELECT * FROM tickets WHERE order_id = ?', [orderId]);
  
  if (tickets.length > 0 && tickets[0].status !== 'cancelled') {
    // Cancelar el ticket
    await connection.query('UPDATE tickets SET status = ? WHERE order_id = ?', ['cancelled', orderId]);
    
    await wooService.actualizarMetadatos(orderId, [
      { key: '_ticket_status', value: 'cancelled' },
      { key: '_ticket_cancelled_date', value: new Date().toISOString() }
    ]);
    
    console.log(`Ticket ${tickets[0].short_code} cancelado`);

    // Enviar correo de cancelación al cliente (asíncrono, no bloquea)
    setImmediate(async () => {
      try {
        await emailService.enviarCorreoEstado(tickets[0], 'cancelled');
      } catch (error) {
        console.error('Error enviando correo de cancelación:', error);
      }
    });
  }

  // Marcar el webhook como procesado
  await connection.query(
    'UPDATE webhook_events SET processed = true WHERE order_id = ? AND event_type = ?',
    [orderId, eventType]
  );
},

  extraerPAX: (orden) => {
    let pax = 1;
    if (orden.meta_data) {
      const paxMeta = orden.meta_data.find(meta => meta.key === '_pax' || meta.key === 'pax');
      if (paxMeta && paxMeta.value) pax = parseInt(paxMeta.value) || 1;
    }
    if (pax === 1 && orden.line_items) pax = orden.line_items.reduce((total, item) => total + item.quantity, 0);
    return pax;
  },
  extraerProductos: (orden) => {
    if (!orden.line_items) return [];
    return orden.line_items.map(item => ({ nombre: item.name, cantidad: item.quantity, precio: item.price, sku: item.sku || 'N/A' }));
  }
};

module.exports = webhookController;
