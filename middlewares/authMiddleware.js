const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
require('dotenv').config();

const authMiddleware = {
  // Verificar token JWT para staff
  verificarToken: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Acceso no autorizado',
          message: 'Se requiere token de autenticacion'
        });
      }

      const token = authHeader.split(' ')[1];
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const [staff] = await pool.query(
        'SELECT id, username, nombre, rol, activo FROM staff WHERE id = ? AND activo = true',
        [decoded.staff_id]
      );

      if (staff.length === 0) {
        return res.status(401).json({
          error: 'Token invalido',
          message: 'El usuario ya no esta activo'
        });
      }

      req.staff = {
        staff_id: staff[0].id,
        username: staff[0].username,
        nombre: staff[0].nombre,
        rol: staff[0].rol
      };
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token expirado',
          message: 'El token ha expirado, inicie sesion nuevamente'
        });
      }
      
      return res.status(401).json({ 
        error: 'Token invalido',
        message: 'El token no es valido'
      });
    }
  },

  // Verificar rol de administrador
  verificarAdmin: (req, res, next) => {
    if (req.staff && req.staff.rol === 'admin') {
      next();
    } else {
      return res.status(403).json({ 
        error: 'Acceso denegado',
        message: 'Se requieren permisos de administrador'
      });
    }
  },

  // Verificar rol administrador o supervisor
  verificarAdminOSupervisor: (req, res, next) => {
    if (req.staff && (req.staff.rol === 'admin' || req.staff.rol === 'supervisor')) {
      next();
    } else {
      return res.status(403).json({
        error: 'Acceso denegado',
        message: 'Se requieren permisos de administrador o supervisor'
      });
    }
  },

  // Verificar dispositivo registrado
  verificarDispositivo: async (req, res, next) => {
    try {
      const deviceId = req.headers['x-device-id'] || req.body.device_id;
      
      if (!deviceId) {
        return res.status(400).json({ 
          error: 'Dispositivo no identificado',
          message: 'Se requiere ID del dispositivo'
        });
      }

      const [dispositivos] = await pool.query(
        'SELECT * FROM devices WHERE device_id = ? AND activo = true',
        [deviceId]
      );

      if (dispositivos.length === 0) {
        return res.status(403).json({ 
          error: 'Dispositivo no autorizado',
          message: 'Este dispositivo no esta registrado en el sistema'
        });
      }

      req.device = dispositivos[0];
      next();
    } catch (error) {
      console.error('Error verificando dispositivo:', error);
      return res.status(500).json({ 
        error: 'Error interno',
        message: 'Error al verificar dispositivo'
      });
    }
  }
};

module.exports = authMiddleware;
