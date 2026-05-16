const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

// Importar rutas
const webhookRoutes = require('./routes/webhooks');
const ticketRoutes = require('./routes/tickets');
const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reportes');


// Importar servicios
const emailService = require('./services/emailService');
const syncService = require('./services/syncService');

const app = express();

// Seguridad basica
app.use(helmet());

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origen no permitido por CORS'));
  }
}));

// Parseo de JSON
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = Buffer.from(buf);
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// Montar rutas
app.use('/api/webhooks', webhookRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/reportes', reportRoutes);
// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salio mal'
  });
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV}`);
  
  // Inicializar servicios
  emailService.inicializar();
  syncService.inicializar();
});

module.exports = app;
