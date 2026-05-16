const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware.verificarToken);
router.use((req, res, next) => {
  if (req.staff.rol === 'admin' || req.staff.rol === 'supervisor') {
    return next();
  }
  return res.status(403).json({ error: 'Acceso denegado', message: 'Requiere rol admin o supervisor' });
});

router.get('/escaneos', reportController.reporteEscaneos);
router.get('/no-escaneados', reportController.reporteNoEscaneados);
router.get('/exportar', reportController.exportarCSV);  // ← agregar esta línea

module.exports = router;