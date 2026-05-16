const axios = require('axios');
require('dotenv').config();

const wooService = {
  api: axios.create({
    baseURL: process.env.WC_API_URL,
    auth: {
      username: process.env.WC_CONSUMER_KEY,
      password: process.env.WC_CONSUMER_SECRET
    },
    timeout: 10000
  }),

  // Obtener ordenes por estado
  obtenerOrdenes: async (estado = 'completed', pagina = 1, porPagina = 50, filtros = {}) => {
    try {
      const response = await wooService.api.get('/orders', {
        params: {
          status: estado,
          page: pagina,
          per_page: porPagina,
          orderby: 'date',
          order: 'desc',
          ...filtros
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error obteniendo ordenes de WooCommerce:', error.message);
      throw error;
    }
  },

  // Obtener una orden especifica
  obtenerOrden: async (orderId) => {
    try {
      const response = await wooService.api.get(`/orders/${orderId}`);
      return response.data;
    } catch (error) {
      console.error(`Error obteniendo orden ${orderId}:`, error.message);
      throw error;
    }
  },

  // Actualizar metadatos de una orden
  actualizarMetadatos: async (orderId, metadatos) => {
    try {
      const response = await wooService.api.put(`/orders/${orderId}`, {
        meta_data: metadatos
      });
      return response.data;
    } catch (error) {
      console.error(`Error actualizando orden ${orderId}:`, error.message);
      throw error;
    }
  }
};

module.exports = wooService;
