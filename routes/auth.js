const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/connection');
const authMiddleware = require('../middlewares/authMiddleware');
require('dotenv').config();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiados intentos',
    message: 'Demasiados intentos de login, intente nuevamente mas tarde'
  }
});

// ========================
// LOGIN DEL STAFF
// ========================
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Datos incompletos',
        message: 'Usuario y contraseña son requeridos'
      });
    }

    // Buscar usuario
    const [usuarios] = await pool.query(
      'SELECT * FROM staff WHERE username = ? AND activo = true',
      [username]
    );

    if (usuarios.length === 0) {
      return res.status(401).json({
        error: 'Autenticación fallida',
        message: 'Usuario o contraseña incorrectos'
      });
    }

    const usuario = usuarios[0];

    // Verificar contraseña
    const passwordValido = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordValido) {
      return res.status(401).json({
        error: 'Autenticación fallida',
        message: 'Usuario o contraseña incorrectos'
      });
    }

    // Generar token JWT
    const token = jwt.sign(
      {
        staff_id: usuario.id,
        username: usuario.username,
        nombre: usuario.nombre,
        rol: usuario.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '8h' }
    );

    res.json({
      success: true,
      token,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        nombre: usuario.nombre,
        rol: usuario.rol
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      error: 'Error interno',
      message: 'Error al procesar el login'
    });
  }
});

// ========================
// CREAR NUEVO STAFF (solo admin)
// ========================
router.post('/register-staff',
  authMiddleware.verificarToken,
  authMiddleware.verificarAdmin,
  async (req, res) => {
    try {
      const { username, password, nombre } = req.body;

      if (!username || !password || !nombre) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }

      // Verificar si el username ya existe
      const [existente] = await pool.query('SELECT id FROM staff WHERE username = ?', [username]);
      if (existente.length > 0) {
        return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const [result] = await pool.query(
        'INSERT INTO staff (username, password_hash, nombre, rol) VALUES (?, ?, ?, ?)',
        [username, passwordHash, nombre, 'scanner'] // siempre scanner
      );

      res.status(201).json({
        success: true,
        staff: {
          id: result.insertId,
          username,
          nombre,
          rol: 'scanner'
        }
      });
    } catch (error) {
      console.error('Error creando staff:', error);
      res.status(500).json({ error: 'Error al crear el usuario' });
    }
  }
);

// ========================
// LISTAR TODO EL STAFF (solo admin)
// ========================
router.get('/staff',
  authMiddleware.verificarToken,
  authMiddleware.verificarAdmin,
  async (req, res) => {
    try {
      const [staff] = await pool.query(
        'SELECT id, username, nombre, rol, activo, created_at FROM staff ORDER BY nombre'
      );
      res.json({ staff });
    } catch (error) {
      console.error('Error obteniendo staff:', error);
      res.status(500).json({ error: 'Error al obtener personal' });
    }
  }
);


router.put('/staff/:id',
  authMiddleware.verificarToken,
  authMiddleware.verificarAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, rol, activo } = req.body;

      if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      const [result] = await pool.query(
        'UPDATE staff SET nombre = ?, rol = ?, activo = ? WHERE id = ?',
        [nombre, rol, activo ? 1 : 0, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Staff no encontrado' });
      }

      const [updated] = await pool.query(
        'SELECT id, username, nombre, rol, activo, created_at FROM staff WHERE id = ?',
        [id]
      );

      res.json({ success: true, staff: updated[0] });
    } catch (error) {
      console.error('Error actualizando staff:', error);
      res.status(500).json({ error: 'Error al actualizar el personal' });
    }
  }
);


router.delete('/staff/:id',
  authMiddleware.verificarToken,
  authMiddleware.verificarAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

   
      if (req.staff.staff_id === parseInt(id)) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
      }

      const [result] = await pool.query(
        'DELETE FROM staff WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Staff no encontrado' });
      }

      res.json({ success: true, message: 'Usuario eliminado correctamente' });
    } catch (error) {
      console.error('Error eliminando staff:', error);
      res.status(500).json({ error: 'Error al eliminar el personal' });
    }
  }
);


router.post('/devices/register',
  authMiddleware.verificarToken,
  authMiddleware.verificarAdmin,
  async (req, res) => {
    try {
      const { device_id, nombre, tipo } = req.body;

      if (!device_id || !nombre) {
        return res.status(400).json({
          error: 'Datos incompletos',
          message: 'device_id y nombre son requeridos'
        });
      }

      const [existentes] = await pool.query(
        'SELECT * FROM devices WHERE device_id = ?',
        [device_id]
      );

      if (existentes.length > 0) {
        return res.status(409).json({
          error: 'Dispositivo duplicado',
          message: 'Este dispositivo ya está registrado'
        });
      }

      const [resultado] = await pool.query(
        'INSERT INTO devices (device_id, nombre, tipo) VALUES (?, ?, ?)',
        [device_id, nombre, tipo || 'desktop']
      );

      res.status(201).json({
        success: true,
        message: 'Dispositivo registrado correctamente',
        dispositivo: {
          id: resultado.insertId,
          device_id,
          nombre,
          tipo: tipo || 'desktop'
        }
      });
    } catch (error) {
      console.error('Error registrando dispositivo:', error);
      res.status(500).json({
        error: 'Error interno',
        message: 'Error al registrar dispositivo'
      });
    }
  }
);


router.get('/verify',
  authMiddleware.verificarToken,
  (req, res) => {
    res.json({
      valid: true,
      usuario: req.staff
    });
  }
);

// ========================
// SETUP INICIAL (solo desarrollo)
// ========================
if (process.env.NODE_ENV === 'development') {
  router.post('/setup-admin', async (req, res) => {
    try {
      const { username, password, nombre } = req.body;

      const [existentes] = await pool.query('SELECT COUNT(*) as total FROM staff');
      
      if (existentes[0].total > 0) {
        return res.status(400).json({
          error: 'Setup no permitido',
          message: 'Ya existen usuarios en el sistema'
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      
      await pool.query(
        'INSERT INTO staff (username, password_hash, nombre, rol) VALUES (?, ?, ?, ?)',
        [username, passwordHash, nombre, 'admin']
      );

      res.status(201).json({
        success: true,
        message: 'Usuario administrador creado correctamente'
      });
    } catch (error) {
      console.error('Error creando admin:', error);
      res.status(500).json({
        error: 'Error interno',
        message: 'Error al crear administrador'
      });
    }
  });
}

module.exports = router;
