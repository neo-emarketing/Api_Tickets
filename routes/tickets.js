const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middlewares/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiting especifico para escaneo
const scanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30,
  message: { 
    resultado: 'error',
    message: 'Demasiados intentos de escaneo, espere un momento' 
  }
});

// Todas las rutas requieren autenticacion JWT
router.use(authMiddleware.verificarToken);

// Ruta de escaneo (requiere autenticacion y dispositivo registrado)
router.post('/scan', 
  scanLimiter,
  authMiddleware.verificarDispositivo,
  ticketController.escanearTicket
);

// Obtener ticket por ID
router.get('/:id', ticketController.obtenerTicket);


router.post('/:id/cancel-scan', 
  authMiddleware.verificarToken,
  (req, res, next) => {
    if (req.staff.rol === 'admin' || req.staff.rol === 'supervisor') {
      return next();
    }
    return res.status(403).json({ error: 'No tienes permisos para reactivar tickets' });
  },
  ticketController.cancelarEscaneo
);

// Listar tickets con filtros
router.get('/', ticketController.listarTickets);

// Cambiar status de ticket (solo admin)
router.patch('/:id/status', 
  authMiddleware.verificarAdmin,
  ticketController.cambiarStatus
);

module.exports = router;
