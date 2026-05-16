const cron = require('node-cron');
const pool = require('../db/connection');
const wooService = require('./wooService');
const qrService = require('./qrService');
const emailService = require('./emailService');
const crypto = require('crypto');
const orderProcessingRules = require('./orderProcessingRules');
require('dotenv').config();

const syncService = {
  // Inicializar cron jobs
  inicializar: () => {
    console.log('Inicializando servicio de sincronizacion...');
    
    // Sincronizacion periodica cada 1 minuto
    cron.schedule('* * * * *', async () => {
      console.log('Ejecutando sincronizacion periodica...');
      await syncService.sincronizarOrdenes();
    });

    // Limpieza diaria de registros antiguos (3 AM)
    cron.schedule('0 3 * * *', async () => {
      console.log('Ejecutando limpieza de registros...');
      await syncService.limpiarRegistrosAntiguos();
    });

    console.log('Servicio de sincronizacion inicializado');
  },

  // Sincronizar ordenes de WooCommerce (Versión actualizada con reactivaciones)
  sincronizarOrdenes: async () => {
    try {
      const estados = ['processing', 'completed', 'cancelled'];
      const after = orderProcessingRules.getWooAfterParam();
      const filtrosWoo = after ? { after } : {};
      const promesas = estados.map(estado => wooService.obtenerOrdenes(estado, 1, 100, filtrosWoo));
      const resultados = await Promise.all(promesas);
      const ordenesWC = resultados.flat();

      console.log(`Obtenidas ${ordenesWC.length} ordenes de WooCommerce`);

      const { allowed: ordenesAProcesar, skipped } = orderProcessingRules.filterOrders(ordenesWC);
      if (process.env.TEST_EMAILS || process.env.ORDER_PROCESSING_START_DATE) {
        console.log(`Reglas de procesamiento: ${ordenesAProcesar.length} ordenes pasan filtros (de ${ordenesWC.length}). Ignoradas por email: ${skipped.email_not_allowed}, por fecha: ${skipped.before_start_date}`);
      }

      const [ordenesLocales] = await pool.query('SELECT order_id, status FROM tickets');
      const mapaLocal = new Map(ordenesLocales.map(o => [o.order_id, o.status]));

      let generadas = 0, ignoradas = 0, cancelaciones = 0, reactivaciones = 0, errores = 0;

      for (const orden of ordenesAProcesar) {
        const existe = mapaLocal.has(orden.id);
        const estadoLocal = mapaLocal.get(orden.id);

        if (orden.status === 'cancelled') {
          if (existe && estadoLocal !== 'cancelled') {
            try {
              await pool.query('UPDATE tickets SET status = ? WHERE order_id = ?', ['cancelled', orden.id]);
              await wooService.actualizarMetadatos(orden.id, [
                { key: '_ticket_status', value: 'cancelled' },
                { key: '_ticket_cancelled_date', value: new Date().toISOString() }
              ]);
              cancelaciones++;
            } catch (err) { errores++; console.error(`Error cancelando ticket de orden ${orden.id}:`, err); }
          }
          continue;
        }

        if (orden.status === 'processing' || orden.status === 'completed') {
          if (existe && estadoLocal === 'cancelled') {
            // Reactivar ticket cancelado
            try {
              await syncService.reactivarTicket(orden);
              reactivaciones++;
            } catch (err) { errores++; console.error(`Error reactivando ticket de orden ${orden.id}:`, err); }
          } else if (!existe) {
            // Crear nuevo ticket
            try {
              await syncService.procesarOrden(orden);
              generadas++;
            } catch (err) { errores++; console.error(`Error procesando orden ${orden.id}:`, err); }
          } else {
            ignoradas++;
          }
        }
      }

      console.log(`Sincronizacion: ${generadas} generadas, ${reactivaciones} reactivadas, ${cancelaciones} canceladas, ${ignoradas} ignoradas, ${errores} errores`);
      return { procesadas: generadas, reactivaciones, cancelaciones, ignoradas, errores };
    } catch (error) {
      console.error('Error en sincronizacion periodica:', error);
    }
  },

  procesarOrden: async (orden) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pax = extraerPAX(orden);
      const productos = extraerProductos(orden);
      const ordenData = {
        order_id: orden.id,
        email_cliente: orden.billing.email,
        nombre_cliente: `${orden.billing.first_name} ${orden.billing.last_name}`,
        pax, productos
      };

      const tokenData = `${orden.id}${process.env.JWT_SECRET}${Date.now()}`;
      const token = crypto.createHash('sha256').update(tokenData).digest('hex');
      const shortCode = `TKT-${orden.id}`;  // Usamos número de pedido

      const qrData = JSON.stringify({ token, short_code: shortCode, order_id: orden.id });
      const qrBase64 = await qrService.generarQRBase64(qrData);

      await connection.query(
        'INSERT INTO tickets (order_id, token, short_code, email_cliente, nombre_cliente, pax, productos, status, qr_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ordenData.order_id, token, shortCode, ordenData.email_cliente, ordenData.nombre_cliente, pax, JSON.stringify(productos), 'active', qrBase64]
      );

      const ticketData = { token, short_code: shortCode, nombre_cliente: ordenData.nombre_cliente, email_cliente: ordenData.email_cliente, pax, productos, qr_base64: qrBase64 };

      await emailService.enviarTicket(ticketData);
      await connection.query('UPDATE tickets SET pdf_path = NULL, email_sent = true WHERE token = ?', [token]);

      await wooService.actualizarMetadatos(orden.id, [
        { key: '_ticket_status', value: 'active' },
        { key: '_ticket_code', value: shortCode },
        { key: '_ticket_generated_date', value: new Date().toISOString() },
        { key: '_ticket_generated_by', value: 'sync_service' }
      ]);

      await connection.commit();
      console.log(`Ticket generado via sync: ${shortCode} para orden ${orden.id}`);
      return shortCode;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
  
  limpiarRegistrosAntiguos: async () => {
    try {
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 90);
      
      const [resultado] = await pool.query(
        'DELETE FROM scan_attempts WHERE created_at < ?',
        [fechaLimite]
      );
      
      console.log(`Limpieza completada: ${resultado.affectedRows} registros eliminados`);
      return resultado.affectedRows;
    } catch (error) {
      console.error('Error en limpieza de registros:', error);
    }
  },

  reactivarTicket: async (orden) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const orderId = orden.id;
      const tokenData = `${orderId}${process.env.JWT_SECRET}${Date.now()}`;
      const token = crypto.createHash('sha256').update(tokenData).digest('hex');
      const shortCode = `TKT-${orderId}`;
      const qrData = JSON.stringify({ token, short_code: shortCode, order_id: orderId });
      const qrBase64 = await qrService.generarQRBase64(qrData);

      const pax = extraerPAX(orden);
      const productos = extraerProductos(orden);

      await connection.query(
        'UPDATE tickets SET token = ?, qr_code = ?, nombre_cliente = ?, email_cliente = ?, pax = ?, productos = ?, status = ?, scanned_at = NULL, scanned_by = NULL, device_id = NULL WHERE order_id = ?',
        [token, qrBase64, `${orden.billing.first_name} ${orden.billing.last_name}`, orden.billing.email, pax, JSON.stringify(productos), 'active', orderId]
      );

      const ticketData = { token, short_code: shortCode, nombre_cliente: `${orden.billing.first_name} ${orden.billing.last_name}`, email_cliente: orden.billing.email, pax, productos, qr_base64: qrBase64 };

      await emailService.enviarTicket(ticketData);
      await connection.query('UPDATE tickets SET pdf_path = NULL, email_sent = true WHERE token = ?', [token]);

      await wooService.actualizarMetadatos(orderId, [
        { key: '_ticket_status', value: 'active' },
        { key: '_ticket_code', value: shortCode },
        { key: '_ticket_reactivated_date', value: new Date().toISOString() }
      ]);

      await connection.commit();
      console.log(`Ticket reactivado via sync: ${shortCode}`);
      return shortCode;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

}; 

// Funciones auxiliares
function extraerPAX(orden) {
  let pax = 1;
  
  if (orden.meta_data) {
    const paxMeta = orden.meta_data.find(meta => meta.key === '_pax' || meta.key === 'pax');
    if (paxMeta && paxMeta.value) {
      pax = parseInt(paxMeta.value) || 1;
    }
  }

  if (pax === 1 && orden.line_items) {
    pax = orden.line_items.reduce((total, item) => total + item.quantity, 0);
  }

  return pax;
}

function extraerProductos(orden) {
  if (!orden.line_items) return [];
  
  return orden.line_items.map(item => ({
    nombre: item.name,
    cantidad: item.quantity,
    precio: item.price,
    sku: item.sku || 'N/A'
  }));
}

module.exports = syncService;
