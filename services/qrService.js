const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const qrService = {
  generarQRBase64: async (data) => {
    try {
      const qrOptions = {
        errorCorrectionLevel: 'H',
        type: 'png',
        width: 400,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      };
      return await QRCode.toDataURL(data, qrOptions);
    } catch (error) {
      console.error('Error generando QR:', error);
      throw error;
    }
  },

  generarPDF: async (ticketData) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Ticket ${ticketData.short_code}`,
          Author: 'Granja las Americas - Sistema POS QR'
        }
      });

      const pdfPath = path.join(__dirname, '../storage/tickets', `${ticketData.token}.pdf`);
      const writeStream = fs.createWriteStream(pdfPath);
      doc.pipe(writeStream);

      // ===== ENCABEZADO =====
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a5c2a');
      doc.text('Granja las Americas', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(14).font('Helvetica').fillColor('#333333');
      doc.text('Ticket de Entrada', { align: 'center' });
      doc.moveDown(1);

      // Línea decorativa
      doc.strokeColor('#1a5c2a').lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // ===== INFORMACIÓN DEL TICKET =====
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000');
      doc.text(`Ticket: ${ticketData.short_code}`);
      doc.fontSize(11).font('Helvetica').fillColor('#444444');
      doc.text(`Fecha de emision: ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}`);
      doc.moveDown(0.5);

      // ===== DATOS DEL CLIENTE =====
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a5c2a');
      doc.text('Datos del Cliente', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').fillColor('#000000');
      doc.text(`Nombre: ${ticketData.nombre_cliente}`);
      doc.text(`Email: ${ticketData.email_cliente}`);
      doc.text(`Personas (PAX): ${ticketData.pax}`);
      doc.moveDown(0.5);

      // ===== PRODUCTOS (si existen) =====
      if (ticketData.productos && ticketData.productos.length > 0) {
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a5c2a');
        doc.text('Productos incluidos', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica').fillColor('#000000');
        ticketData.productos.forEach((prod, index) => {
          doc.text(`${index + 1}. ${prod.nombre} x${prod.cantidad} - $${prod.precio}`);
        });
        doc.moveDown(1);
      }

      // ===== CÓDIGO QR =====
      if (ticketData.qr_base64) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a5c2a');
        doc.text('Codigo QR de Acceso', { align: 'center' });
        doc.moveDown(0.5);
        const qrBuffer = Buffer.from(ticketData.qr_base64.split(',')[1], 'base64');
        doc.image(qrBuffer, { fit: [180, 180], align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica').fillColor('#666666');
        doc.text('Presente este codigo en la entrada para su validacion.', { align: 'center' });
      }

      // ===== PIE DE PÁGINA =====
      doc.moveDown(1.5);
      doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(8).font('Helvetica').fillColor('#888888');
      doc.text('Este ticket es valido para un solo uso. Llegue 15 minutos antes de su horario.', { align: 'center' });
      doc.text('Granja las Americas - Cancun, Quintana Roo', { align: 'center' });

      doc.end();

      return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve(pdfPath));
        writeStream.on('error', reject);
      });
    } catch (error) {
      console.error('Error generando PDF:', error);
      throw error;
    }
  }
};

module.exports = qrService;