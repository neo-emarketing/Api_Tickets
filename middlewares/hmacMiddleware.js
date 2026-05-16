const crypto = require('crypto');
require('dotenv').config();

const hmacMiddleware = (req, res, next) => {
  try {
    const signature = req.headers['x-wc-webhook-signature'];
    
    if (!signature) {
      console.warn('Webhook recibido sin firma HMAC');
      return res.status(401).json({ 
        error: 'Firma HMAC requerida',
        message: 'El webhook no incluye firma de verificacion'
      });
    }

    if (!process.env.WC_WEBHOOK_SECRET) {
      console.error('WC_WEBHOOK_SECRET no configurado');
      return res.status(500).json({
        error: 'Configuracion invalida',
        message: 'No se puede verificar el webhook'
      });
    }

    // WooCommerce firma el cuerpo crudo, no el objeto JSON reconstruido.
    const payload = req.rawBody || Buffer.from(JSON.stringify(req.body));
    
    // Calcular HMAC con el secret compartido
    const hmac = crypto.createHmac('sha256', process.env.WC_WEBHOOK_SECRET);
    const calculatedSignature = hmac.update(payload).digest();

    // Comparar firmas de manera segura (timing-safe)
    const signatureBuffer = Buffer.from(signature, 'base64');
    
    if (signatureBuffer.length !== calculatedSignature.length || 
        !crypto.timingSafeEqual(signatureBuffer, calculatedSignature)) {
      console.warn('Firma HMAC invalida en webhook');
      return res.status(401).json({ 
        error: 'Firma HMAC invalida',
        message: 'La firma del webhook no coincide'
      });
    }

    console.log('Webhook verificado correctamente');
    next();
  } catch (error) {
    console.error('Error en verificacion HMAC:', error);
    return res.status(500).json({ 
      error: 'Error de verificacion',
      message: 'Error al verificar la firma del webhook'
    });
  }
};

module.exports = hmacMiddleware;
