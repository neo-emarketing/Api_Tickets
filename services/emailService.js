const nodemailer = require('nodemailer');
require('dotenv').config();

const emailService = {
  transporter: null,

  // Inicializar transporter
  inicializar: () => {
    emailService.transporter = nodemailer.createTransport({
      pool: true,
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_PORT === '465',
      maxConnections: parseInt(process.env.SMTP_MAX_CONNECTIONS || '3', 10),
      maxMessages: parseInt(process.env.SMTP_MAX_MESSAGES || '100', 10),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    // Verificar conexion
    emailService.transporter.verify()
      .then(() => console.log('Servidor de email configurado correctamente'))
      .catch(error => console.error('Error configurando email:', error));
  },

  // Enviar ticket por email
  enviarTicket: async (ticketData) => {
    try {
      if (!emailService.transporter) {
        emailService.inicializar();
      }

      // 1. Configuramos las opciones base (SOLO UNA VEZ)
      const mailOptions = {
        from: `"Granja las Americas" <${process.env.EMAIL_FROM}>`,
        to: ticketData.email_cliente,
        subject: `Tu Ticket de Entrada - ${ticketData.short_code}`,
        html: emailService.generarPlantillaHTML(ticketData),
        attachments: [
          // Adjuntamos el logo directamente para evitar bloqueos
          {
            filename: 'logo-granja.png',
            path: '../posBack/assets/unnamed.png',
            cid: 'logo_granja' // Este ID lo usaremos en el HTML
          }
        ]
      };
      
      // 2. EL TRUCO DEL QR: Lo adjuntamos como imagen incrustada (CID)
      if (ticketData.qr_base64) {
        const qrPath = ticketData.qr_base64.includes('data:image') 
          ? ticketData.qr_base64 
          : `data:image/png;base64,${ticketData.qr_base64}`;

        mailOptions.attachments.push({
          filename: 'qrcode.png',
          path: qrPath,
          cid: 'codigo_qr_ticket'
        });
      }

      const info = await emailService.transporter.sendMail(mailOptions);
      console.log('Email enviado:', info.messageId);
      return info;
    } catch (error) {
      console.error('Error enviando email:', error);
      throw error;
    }
  },

  // Generar plantilla HTML del email
  generarPlantillaHTML: (ticketData) => {
    const fechaOpciones = { month: 'long', day: 'numeric', year: 'numeric' };
    const fechaTexto = new Date().toLocaleDateString('es-MX', fechaOpciones);

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; color: #333333; margin: 0; padding: 0; background-color: #f4f6f8; }
            .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
            .logo-container { text-align: center; padding: 30px 20px; }
            .logo-container img { max-width: 250px; }
            .banner { background-color: #7B0000; color: #F3B204; padding: 25px 30px; text-align: left; font-size: 22px; line-height: 1.4; }
            .content { padding: 30px; }
            .greeting p { margin: 10px 0; font-size: 15px; color: #444; }
            .order-title { color: #7B0000; font-size: 18px; font-weight: bold; margin: 25px 0 15px 0; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; }
            .table th, .table td { padding: 12px 10px; text-align: left; border-bottom: 1px solid #eeeeee; }
            .table th { font-weight: bold; background-color: #fafafa; color: #333; }
            .table .right { text-align: right; }
            .totals-row td { font-weight: bold; border-bottom: none; padding-top: 15px; }
            .billing-box { border: 1px solid #e0e0e0; padding: 20px; margin-bottom: 35px; font-size: 14px; line-height: 1.6; color: #555; }
            .billing-title { color: #7B0000; font-size: 16px; font-weight: bold; margin-bottom: 12px; }
            .billing-box a { color: #0066cc; text-decoration: none; }
            .ticket-box { border: 2px dashed #F3B204; border-radius: 8px; text-align: center; padding: 40px 20px; margin: 20px 0; background-color: #fffcf5; }
            .ticket-type { color: #F3B204; font-weight: bold; letter-spacing: 3px; font-size: 14px; margin-bottom: 20px; }
            .ticket-number { color: #7B0000; font-size: 54px; font-weight: bold; margin: 15px 0; line-height: 1; }
            .ticket-qr { margin: 20px 0; }
            .ticket-footer { color: #666666; font-size: 14px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          
          <div class="logo-container">
            <img src="cid:logo_granja" alt="Granja las Américas">
          </div>

          <div class="banner">
            Gracias por su compra. Aquí está tu boleto digital
          </div>

          <div class="content">
            <div class="greeting">
              <p>Hola ${ticketData.nombre_cliente},</p>
              <p>Este es tu boleto digital, por favor preséntalo en tu celular o impreso.</p>
            </div>

            <div class="order-title">
              [Pedido #${ticketData.short_code}] (${fechaTexto})
            </div>

            <table class="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th class="right">Precio</th>
                </tr>
              </thead>
              <tbody>
                ${ticketData.productos && ticketData.productos.length > 0 ? ticketData.productos.map(p => `
                <tr>
                  <td>${p.nombre}</td>
                  <td>${p.cantidad}</td>
                  <td class="right">$${p.precio ? parseFloat(p.precio).toFixed(2) : '0.00'}</td>
                </tr>
                `).join('') : `
                <tr>
                  <td>Entrada General</td>
                  <td>${ticketData.pax || 1}</td>
                  <td class="right">$249.00</td>
                </tr>
                `}
                <tr class="totals-row">
                  <td colspan="2">Subtotal:</td>
                  <td class="right">$${ticketData.subtotal ? parseFloat(ticketData.subtotal).toFixed(2) : '0.00'}</td>
                </tr>
                <tr class="totals-row">
                  <td colspan="2" style="padding-top: 5px;">Descuento:</td>
                  <td class="right" style="padding-top: 5px;">-$${ticketData.descuento ? parseFloat(ticketData.descuento).toFixed(2) : '0.00'}</td>
                </tr>
                <tr class="totals-row">
                  <td colspan="2" style="padding-top: 5px;">Total:</td>
                  <td class="right" style="padding-top: 5px;">$${ticketData.total ? parseFloat(ticketData.total).toFixed(2) : '0.00'}</td>
                </tr>
              </tbody>
            </table>

            <div class="billing-box">
              <div class="billing-title">Dirección de facturación</div>
              <div>${ticketData.nombre_cliente}</div>
              <div>${ticketData.telefono || ''}</div>
              <div><a href="mailto:${ticketData.email_cliente}">${ticketData.email_cliente}</a></div>
            </div>

            <div class="ticket-box">
              <div class="ticket-type">ACCESO GENERAL</div>
              <div class="ticket-number">#${ticketData.short_code}</div>
              
              ${ticketData.qr_base64 ? `
              <div class="ticket-qr">
                  <img src="cid:codigo_qr_ticket" alt="Código QR" style="width: 150px; height: 150px;">
              </div>
              ` : ''}
              
              <div class="ticket-footer">Muestra este código en taquilla</div>
            </div>

          </div>
        </div>
      </body>
      </html>
    `;
  },

  enviarCorreoEstado: async (ticketData, estado) => {
  try {
    if (!emailService.transporter) {
      emailService.inicializar();
    }

    let subject, mensaje, colorEstado;
    switch (estado) {
      case 'scanned':
        subject = `Tu ticket ha sido validado - ${ticketData.short_code}`;
        mensaje = 'Tu ticket ha sido escaneado exitosamente. Gracias por tu visita.';
        colorEstado = '#2E7D32';
        break;
      case 'reactivated':
        subject = `Tu ticket ha sido reactivado - ${ticketData.short_code}`;
        mensaje = 'Tu ticket ha sido reactivado y puede ser utilizado nuevamente. Presenta el código QR en la entrada.';
        colorEstado = '#F3B204';
        break;
      case 'cancelled':
        subject = `Tu ticket ha sido cancelado - ${ticketData.short_code}`;
        mensaje = 'Lamentamos informarte que tu ticket ha sido cancelado. Si tienes dudas, contáctanos.';
        colorEstado = '#c62828';
        break;
      default:
        subject = `Actualización de tu ticket - ${ticketData.short_code}`;
        mensaje = 'El estado de tu ticket ha cambiado.';
        colorEstado = '#666666';
    }

    const mailOptions = {
      from: `"Granja las Américas" <${process.env.EMAIL_FROM}>`,
      to: ticketData.email_cliente,
      subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:Arial,sans-serif; max-width:600px; margin:20px auto;">
          <div style="text-align:center; padding:20px;">
            <h1 style="color:#7B0000; margin:0;">Granja las Américas</h1>
          </div>
          <div style="background:${colorEstado}; padding:20px; color:#fff; font-size:20px; text-align:center;">
            ${subject}
          </div>
          <div style="padding:30px; background:#fafafa;">
            <p style="font-size:16px;">Hola ${ticketData.nombre_cliente},</p>
            <p style="font-size:15px; line-height:1.6;">${mensaje}</p>
            <div style="text-align:center; margin:30px 0;">
              <p style="font-size:24px; font-weight:bold; color:#7B0000;">${ticketData.short_code}</p>
              ${ticketData.qr_code ? `<img src="cid:codigo_qr_ticket" alt="QR" style="width:180px; height:180px;">` : ''}
            </div>
            <p style="font-size:13px; color:#666;">Fecha: ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', hour:'2-digit', minute:'2-digit' })}</p>
          </div>
        </body>
        </html>
      `,
      attachments: []
    };

    // Adjuntar logo y QR embebido (si existe)
    mailOptions.attachments.push({
      filename: 'logo-granja.png',
      path: '../posBack/assets/unnamed.png', // Ajusta la ruta según tu proyecto
      cid: 'logo_granja'
    });

    if (ticketData.qr_code) {
      const qrPath = ticketData.qr_code.includes('data:image') ? ticketData.qr_code : `data:image/png;base64,${ticketData.qr_code}`;
      mailOptions.attachments.push({
        filename: 'qrcode.png',
        path: qrPath,
        cid: 'codigo_qr_ticket'
      });
    }

    const info = await emailService.transporter.sendMail(mailOptions);
    console.log(`Correo de estado (${estado}) enviado: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`Error enviando correo de estado (${estado}):`, error);
    throw error;
  }
}
};

module.exports = emailService;
