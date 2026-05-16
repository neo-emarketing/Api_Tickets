require('dotenv').config();

function getTestEmails() {
  return (process.env.TEST_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function getProcessingStartDate() {
  const rawDate = (process.env.ORDER_PROCESSING_START_DATE || '').trim();
  if (!rawDate) return null;

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    console.warn(`ORDER_PROCESSING_START_DATE invalida: "${rawDate}". Se ignorara el filtro de fecha.`);
    return null;
  }

  return date;
}

function getOrderDate(order) {
  const rawDate = order.date_created_gmt
    ? `${order.date_created_gmt}Z`
    : order.date_created;

  if (!rawDate) return null;

  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shouldProcessOrder(order) {
  const testEmails = getTestEmails();
  if (testEmails.length > 0) {
    const emailCliente = (order.billing?.email || '').trim().toLowerCase();
    if (!testEmails.includes(emailCliente)) {
      return {
        allowed: false,
        reason: 'email_not_allowed'
      };
    }
  }

  const startDate = getProcessingStartDate();
  if (startDate) {
    const orderDate = getOrderDate(order);
    if (!orderDate || orderDate < startDate) {
      return {
        allowed: false,
        reason: 'before_start_date'
      };
    }
  }

  return { allowed: true };
}

function filterOrders(orders) {
  const skipped = {
    email_not_allowed: 0,
    before_start_date: 0
  };

  const allowed = orders.filter(order => {
    const decision = shouldProcessOrder(order);
    if (!decision.allowed) {
      skipped[decision.reason] = (skipped[decision.reason] || 0) + 1;
      return false;
    }
    return true;
  });

  return { allowed, skipped };
}

function getWooAfterParam() {
  const startDate = getProcessingStartDate();
  return startDate ? startDate.toISOString() : undefined;
}

module.exports = {
  filterOrders,
  getProcessingStartDate,
  getTestEmails,
  getWooAfterParam,
  shouldProcessOrder
};
