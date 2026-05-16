-- Crear base de datos
CREATE DATABASE IF NOT EXISTS pos_qr_system;
USE pos_qr_system;

-- Tabla de staff
CREATE TABLE IF NOT EXISTS staff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  rol ENUM('admin', 'scanner', 'supervisor') DEFAULT 'scanner',
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de dispositivos autorizados
CREATE TABLE IF NOT EXISTS devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  tipo ENUM('desktop', 'tablet', 'mobile') DEFAULT 'desktop',
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de tickets (principal)
CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL UNIQUE,
  token VARCHAR(64) NOT NULL UNIQUE,
  short_code VARCHAR(20) NOT NULL UNIQUE,
  email_cliente VARCHAR(255) NOT NULL,
  nombre_cliente VARCHAR(200) NOT NULL,
  pax INT DEFAULT 1,
  productos JSON,
  status ENUM('active', 'scanned', 'expired', 'cancelled') DEFAULT 'active',
  qr_code TEXT,
  pdf_path VARCHAR(500),
  email_sent BOOLEAN DEFAULT false,
  scanned_at TIMESTAMP NULL,
  scanned_by INT NULL,
  device_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (scanned_by) REFERENCES staff(id)
);

-- Tabla de intentos de escaneo (auditoria)
CREATE TABLE IF NOT EXISTS scan_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL,
  staff_id INT NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  resultado ENUM('success', 'already_used', 'invalid', 'expired') NOT NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- Tabla de eventos webhook
CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSON,
  processed BOOLEAN DEFAULT false,
  signature_valid BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);