const pool = require('../db/connection');

const sanitizarCSV = (value) => {
  if (value === null || value === undefined) return '';

  let val = String(value).replace(/"/g, '""');
  if (/^[=+\-@]/.test(val)) {
    val = `'${val}`;
  }

  return `"${val}"`;
};

const reportController = {
  // Reporte de tickets escaneados
  reporteEscaneos: async (req, res) => {
    try {
      const {
        fecha_inicio,
        fecha_fin,
        nombre_staff,
        pagina = 1,
        por_pagina = 20
      } = req.query;

      // Base de las condiciones
      let conditions = "WHERE t.status = 'scanned'";
      const params = [];

      if (fecha_inicio) {
        conditions += ' AND t.scanned_at >= ?';
        params.push(fecha_inicio);
      }
      if (fecha_fin) {
        conditions += ' AND t.scanned_at <= ?';
        params.push(fecha_fin + ' 23:59:59');
      }
      if (nombre_staff) {
        conditions += ' AND s.nombre LIKE ?';
        params.push(`%${nombre_staff}%`);
      }

      // 1. Obtener total
      const countSql = `SELECT COUNT(*) as total FROM tickets t JOIN staff s ON t.scanned_by = s.id ${conditions}`;
      const [totalRes] = await pool.query(countSql, params);
      const total = totalRes[0].total;

      // 2. Obtener pagina
      const offset = (pagina - 1) * por_pagina;
      const dataSql = `
        SELECT 
          t.id,
          t.short_code,
          t.nombre_cliente,
          t.pax,
          t.scanned_at,
          s.nombre AS scanned_by_nombre,
          t.status
        FROM tickets t
        JOIN staff s ON t.scanned_by = s.id
        ${conditions}
        ORDER BY t.scanned_at DESC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...params, parseInt(por_pagina), parseInt(offset)];
      const [escaneos] = await pool.query(dataSql, dataParams);

      res.json({
        escaneos,
        paginacion: {
          total,
          pagina: parseInt(pagina),
          por_pagina: parseInt(por_pagina),
          total_paginas: Math.ceil(total / por_pagina)
        }
      });
    } catch (error) {
      console.error('Error generando reporte de escaneos:', error);
      res.status(500).json({
        error: 'Error interno',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Error al generar reporte de escaneos'
      });
    }
  },

  // Reporte de tickets no escaneados
  reporteNoEscaneados: async (req, res) => {
    try {
      const {
        fecha_inicio,
        fecha_fin,
        pagina = 1,
        por_pagina = 20
      } = req.query;

      let conditions = "WHERE status = 'active' AND scanned_at IS NULL";
      const params = [];

      if (fecha_inicio) {
        conditions += ' AND created_at >= ?';
        params.push(fecha_inicio);
      }
      if (fecha_fin) {
        conditions += ' AND created_at <= ?';
        params.push(fecha_fin + ' 23:59:59');
      }

      // Total
      const countSql = `SELECT COUNT(*) as total FROM tickets ${conditions}`;
      const [totalRes] = await pool.query(countSql, params);
      const total = totalRes[0].total;

      // Pagina
      const offset = (pagina - 1) * por_pagina;
      const dataSql = `
        SELECT 
          id,
          short_code,
          order_id,
          nombre_cliente,
          email_cliente,
          pax,
          status,
          created_at
        FROM tickets
        ${conditions}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...params, parseInt(por_pagina), parseInt(offset)];
      const [tickets] = await pool.query(dataSql, dataParams);

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
      console.error('Error generando reporte de no escaneados:', error);
      res.status(500).json({
        error: 'Error interno',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Error al generar reporte de no escaneados'
      });
    }
  },

  // Exportar a CSV
  exportarCSV: async (req, res) => {
    try {
      const {
        fecha_inicio,
        fecha_fin,
        nombre_staff,
        tipo = 'escaneos'   // escaneos o no-escaneados
      } = req.query;

      let query;
      const params = [];

      if (tipo === 'no-escaneados') {
        query = `
          SELECT 
            short_code AS Ticket,
            order_id AS Orden,
            nombre_cliente AS Cliente,
            email_cliente AS Email,
            pax AS PAX,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS 'Fecha creacion'
          FROM tickets
          WHERE status = 'active' AND scanned_at IS NULL
        `;
        if (fecha_inicio) {
          query += ' AND created_at >= ?';
          params.push(fecha_inicio);
        }
        if (fecha_fin) {
          query += ' AND created_at <= ?';
          params.push(fecha_fin + ' 23:59:59');
        }
        query += ' ORDER BY created_at DESC';
      } else {
        query = `
          SELECT 
            t.short_code AS Ticket,
            t.nombre_cliente AS Cliente,
            t.pax AS PAX,
            s.nombre AS 'Escaneado por',
            DATE_FORMAT(t.scanned_at, '%Y-%m-%d %H:%i:%s') AS 'Fecha y hora'
          FROM tickets t
          JOIN staff s ON t.scanned_by = s.id
          WHERE t.status = 'scanned'
        `;
        if (fecha_inicio) {
          query += ' AND t.scanned_at >= ?';
          params.push(fecha_inicio);
        }
        if (fecha_fin) {
          query += ' AND t.scanned_at <= ?';
          params.push(fecha_fin + ' 23:59:59');
        }
        if (nombre_staff) {
          query += ' AND s.nombre LIKE ?';
          params.push(`%${nombre_staff}%`);
        }
        query += ' ORDER BY t.scanned_at DESC';
      }

      const [rows] = await pool.query(query, params);

      // Generar CSV
      if (rows.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        return res.send('No hay datos\n');
      }

      const headers = Object.keys(rows[0]);
      let csv = headers.join(',') + '\n';

      rows.forEach(row => {
        const valores = headers.map(h => sanitizarCSV(row[h]));
        csv += valores.join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=reporte_${tipo}_${Date.now()}.csv`);
      res.send(csv);
    } catch (error) {
      console.error('Error exportando CSV:', error);
      res.status(500).json({ error: 'Error interno', message: 'Error al exportar' });
    }
  }
};

module.exports = reportController;
