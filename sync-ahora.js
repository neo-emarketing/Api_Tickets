require('dotenv').config();
const syncService = require('./services/syncService');
const wooService = require('./services/wooService');
const orderProcessingRules = require('./services/orderProcessingRules');

(async () => {
  console.log('Ejecutando sincronizacion manual con depuracion...');
  
  // Mostrar reglas configuradas
  console.log('TEST_EMAILS en .env:', process.env.TEST_EMAILS);
  console.log('ORDER_PROCESSING_START_DATE en .env:', process.env.ORDER_PROCESSING_START_DATE);
  
  // Obtener ordenes completadas
  const after = orderProcessingRules.getWooAfterParam();
  const ordenesWC = await wooService.obtenerOrdenes('completed', 1, 100, after ? { after } : {});
  console.log(`Total ordenes obtenidas: ${ordenesWC.length}`);
  
  // Mostrar correos de cada orden
  ordenesWC.forEach((orden, index) => {
    console.log(`Orden #${index+1} - ID: ${orden.id} - Email: "${orden.billing.email}" - Status: ${orden.status}`);
  });

  const { allowed: ordenesFiltradas, skipped } = orderProcessingRules.filterOrders(ordenesWC);

  console.log(`Ordenes que pasan filtro: ${ordenesFiltradas.length}`);
  console.log(`Ignoradas por email: ${skipped.email_not_allowed}, por fecha: ${skipped.before_start_date}`);
  
  // Si hay alguna, ejecutar sincronización normal (pero ya con filtro en syncService)
  if (ordenesFiltradas.length > 0) {
    // Llamamos a la función de sincronización que ya respeta el filtro
    await syncService.sincronizarOrdenes();
  } else {
    console.log('Ninguna orden coincide. Verifica los correos en TEST_EMAILS y en WooCommerce.');
  }
  
  console.log('Depuracion completada.');
  process.exit(0);
})();
