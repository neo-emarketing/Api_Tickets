const pool = require('../db/connection');
const wooService = require('../services/wooService');
const emailService = require('../services/emailService');

const TICKET_PUBLIC_FIELDS = `
  id,
  order_id,
  short_code,
  email_cliente,
  nombre_cliente,
  pax,
  productos,
  status,
  email_sent,
  scanned_at,
  scanned_by,
  device_id,
  created_at,
  updated_at
`;

const ticketController = {
  // Escanear y validar ticket
  escanearTicket: async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
      const { token } = req.body;
      const staff_id = req.staff.staff_id;
      const device_id = req.device.device_id;
      
      // Validar campos requeridos
      if (!token) {
        return res.status(400).json({
          resultado: 'error',
          message: 'Token es requerido'
        });
      }

      // Iniciar transaccion
      await connection.beginTransaction();

      // Bloquear fila del ticket para prevenir race conditions
      const [tickets] = await connection.query(
        'SELECT * FROM tickets WHERE token = ? FOR UPDATE',
        [token]
      );

      let resultado = 'invalid';
      let mensaje = 'Ticket no valido';
      let ticketData = null;

      if (tickets.length === 0) {
        resultado = 'invalid';
        mensaje = 'El ticket no existe o el codigo QR es invalido';
      } else {
        ticketData = tickets[0];
        
        if (ticketData.status === 'active') {
          // Actualizar ticket a escaneado
          await connection.query(
            'UPDATE tickets SET status = ?, scanned_at = NOW(), scanned_by = ?, device_id = ? WHERE token = ?',
            ['scanned', staff_id, device_id, token]
          );
          
          resultado = 'success';
          mensaje = 'Acceso permitido - Ticket valido';
        } else if (ticketData.status === 'scanned') {
          resultado = 'already_used';
          mensaje = 'Este ticket ya fue utilizado anteriormente';
        } else if (ticketData.status === 'expired') {
          resultado = 'expired';
          mensaje = 'Este ticket ha expirado';
        } else if (ticketData.status === 'cancelled') {
          resultado = 'invalid';
          mensaje = 'Este ticket ha sido cancelado';
        }
      }

      // Registrar intento de escaneo (siempre)
      await connection.query(
        'INSERT INTO scan_attempts (token, staff_id, device_id, resultado, ip_address) VALUES (?, ?, ?, ?, ?)',
        [token, staff_id, device_id, resultado, req.ip]
      );

      // Commit de la transaccion
      await connection.commit();

      // Actualizar WooCommerce de forma asincrona si el escaneo fue exitoso
     if (resultado === 'success' && ticketData) {
  setImmediate(async () => {
    try {
      await wooService.actualizarMetadatos(ticketData.order_id, [
        { key: '_ticket_status', value: 'scanned' },
        { key: '_ticket_scanned_date', value: new Date().toISOString() },
        { key: '_ticket_scanned_by', value: staff_id },
        { key: '_ticket_scan_result', value: 'success' }
      ]);
      // Enviar correo de escaneo
      await emailService.enviarCorreoEstado(ticketData, 'scanned');
    } catch (error) {
      console.error('Error post-escaneo:', error);
    }
  });
}

      // Enviar respuesta
      res.json({
        resultado: resultado,
        message: mensaje,
        ticket: {
          short_code: ticketData?.short_code,
          nombre_cliente: ticketData?.nombre_cliente,
          pax: ticketData?.pax,
          productos: ticketData?.productos
        }
      });

    } catch (error) {
      await connection.rollback();
      console.error('Error escaneando ticket:', error);
      res.status(500).json({
        resultado: 'error',
        message: 'Error interno al procesar el escaneo'
      });
    } finally {
      connection.release();
    }
  },


cancelarEscaneo: async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params; // Puede ser id, token o short_code
    const staff_id = req.staff.staff_id;

    await connection.beginTransaction();

    // Bloquear fila
    const [tickets] = await connection.query(
      'SELECT * FROM tickets WHERE (id = ? OR token = ? OR short_code = ?) FOR UPDATE',
      [id, id, id]
    );

    if (tickets.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const ticket = tickets[0];

    if (ticket.status !== 'scanned') {
      await connection.rollback();
      return res.status(400).json({ error: 'El ticket no está escaneado' });
    }

    // Reactivar: status = active, limpiar datos de escaneo
    await connection.query(
      'UPDATE tickets SET status = ?, scanned_at = NULL, scanned_by = NULL, device_id = NULL WHERE id = ?',
      ['active', ticket.id]
    );

    await connection.commit();

    // Enviar correo de reactivación (asíncrono)
    setImmediate(async () => {
      try {
        await emailService.enviarCorreoEstado(ticket, 'reactivated');
        // Opcional: actualizar WooCommerce
        await wooService.actualizarMetadatos(ticket.order_id, [
          { key: '_ticket_status', value: 'active' },
          { key: '_ticket_reactivated_date', value: new Date().toISOString() },
          { key: '_ticket_reactivated_by', value: staff_id }
        ]);
      } catch (error) {
        console.error('Error post-reactivación:', error);
      }
    });

    res.json({ success: true, message: 'Ticket reactivado correctamente' });
  } catch (error) {
    await connection.rollback();
    console.error('Error cancelando escaneo:', error);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    connection.release();
  }
},
  // Obtener ticket por ID
  obtenerTicket: async (req, res) => {
    try {
      const { id } = req.params;
      
      const [tickets] = await pool.query(
        `SELECT ${TICKET_PUBLIC_FIELDS} FROM tickets WHERE id = ? OR token = ? OR short_code = ?`,
        [id, id, id]
      );

      if (tickets.length === 0) {
        return res.status(404).json({
          error: 'Ticket no encontrado',
          message: 'No se encontro un ticket con ese identificador'
        });
      }

      res.json({ ticket: tickets[0] });
    } catch (error) {
      console.error('Error obteniendo ticket:', error);
      res.status(500).json({
        error: 'Error interno',
        message: 'Error al obtener informacion del ticket'
      });
    }
  },

  // Listar tickets con filtros
  listarTickets: async (req, res) => {
    try {
      const { status, fecha_inicio, fecha_fin, pagina = 1, por_pagina = 20 } = req.query;
      
      let query = `SELECT ${TICKET_PUBLIC_FIELDS} FROM tickets WHERE 1=1`;
      const params = [];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      if (fecha_inicio) {
        query += ' AND created_at >= ?';
        params.push(fecha_inicio);
      }

      if (fecha_fin) {
        query += ' AND created_at <= ?';
        params.push(fecha_fin);
      }

      // Obtener total
      const countQuery = query.replace(`SELECT ${TICKET_PUBLIC_FIELDS}`, 'SELECT COUNT(*) as total');
      const [totalResult] = await pool.query(countQuery, params);
      const total = totalResult[0].total;

      // Paginacion
      const offset = (pagina - 1) * por_pagina;
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(por_pagina), parseInt(offset));

      const [tickets] = await pool.query(query, params);

      res.json({
        tickets,
        paginacion: {
          total,
          pagina: parseInt(pagina),
          por_pagina: parseInt(por_pagina),
          total_paginas: Math.ceil(total / por_pagina)
        }
      });
    } catch (error) {
      console.error('Error listando tickets:', error);
      res.status(500).json({
        error: 'Error interno',
        message: 'Error al listar tickets'
      });
    }
  },

  // Cambiar status manualmente (solo admin)
  cambiarStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, motivo } = req.body;

      const estadosValidos = ['active', 'scanned', 'expired', 'cancelled'];
      
      if (!estadosValidos.includes(status)) {
        return res.status(400).json({
          error: 'Status invalido',
          message: `El status debe ser uno de: ${estadosValidos.join(', ')}`
        });
      }

      const [resultado] = await pool.query(
        'UPDATE tickets SET status = ? WHERE id = ? OR token = ?',
        [status, id, id]
      );

      if (resultado.affectedRows === 0) {
        return res.status(404).json({
          error: 'Ticket no encontrado',
          message: 'No se encontro un ticket con ese identificador'
        });
      }

      // Obtener ticket actualizado para sincronizar con WooCommerce
      const [tickets] = await pool.query(
        'SELECT * FROM tickets WHERE id = ? OR token = ?',
        [id, id]
      );

      if (tickets.length > 0) {
        setImmediate(async () => {
          try {
            await wooService.actualizarMetadatos(tickets[0].order_id, [
              { key: '_ticket_status', value: status },
              { key: '_ticket_updated_date', value: new Date().toISOString() },
              { key: '_ticket_updated_by', value: req.staff.staff_id },
              { key: '_ticket_update_reason', value: motivo || 'Cambio manual' }
            ]);
          } catch (error) {
            console.error('Error actualizando WooCommerce:', error);
          }
        });
      }

      res.json({
        success: true,
        message: `Ticket actualizado a estado: ${status}`,
        ticket: tickets[0]
      });
    } catch (error) {
      console.error('Error cambiando status:', error);
      res.status(500).json({
        error: 'Error interno',
        message: 'Error al cambiar el estado del ticket'
      });
    }
  }
};

module.exports = ticketController;
