import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = 'logs';

// Créer le dossier logs s'il n'existe pas
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Format personnalisé pour les logs
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}] [${service || 'voaray'}]: ${message}${metaStr}`;
  })
);

// Configuration des transports
const transports: winston.transport[] = [
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    format: customFormat
  }),
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    maxsize: 5242880,
    maxFiles: 5,
    format: customFormat
  })
];

// Ajouter la console en développement
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${level}: ${message}${metaStr}`;
        })
      )
    })
  );
}

// Créer le logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  defaultMeta: { service: 'voaray-api' },
  transports,
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'exceptions.log') 
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'rejections.log') 
    })
  ]
});

// Créer un logger pour les webhooks
export const webhookLogger = winston.createLogger({
  level: 'info',
  format: customFormat,
  defaultMeta: { service: 'webhook' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'webhooks.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Créer un logger pour les paiements
export const paymentLogger = winston.createLogger({
  level: 'info',
  format: customFormat,
  defaultMeta: { service: 'payment' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'payments.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Créer un logger pour les requêtes API
export const apiLogger = winston.createLogger({
  level: 'info',
  format: customFormat,
  defaultMeta: { service: 'api' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'api.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Fonction pour logger les requêtes HTTP
export const logRequest = (req: any, res: any, duration: number) => {
  apiLogger.info(`${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    duration: `${duration}ms`,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
};

// Fonction pour logger les erreurs
export const logError = (error: Error, context?: any) => {
  logger.error(error.message, {
    stack: error.stack,
    ...context
  });
};

export default logger;