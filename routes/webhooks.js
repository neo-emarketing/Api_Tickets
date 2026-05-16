const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const hmacMiddleware = require('../middlewares/hmacMiddleware');

// Ruta para recibir webhooks de WooCommerce
// Aplicar middleware HMAC para verificar autenticidad
router.post('/woocommerce', hmacMiddleware, webhookController.recibirWebhook);

// Ruta de prueba para webhooks (sin HMAC, solo desarrollo)
if (process.env.NODE_ENV === 'development') {
  router.post('/test', (req, res) => {
    console.log('Webhook de prueba recibido:', req.body);
    res.json({ mensaje: 'Webhook de prueba recibido' });
  });
}

module.exports = router;