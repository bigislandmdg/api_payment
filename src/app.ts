// Imports de valeurs (runtime)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import paymentRoutes from './routes/payment.routes';
import webhookRoutes from './routes/webhook.routes';
import adminRoutes from './routes/admin.routes';
import merchantRoutes from './routes/merchant.routes';
import { errorHandler, notFound } from './middleware/errorHandler';
import logger from './utils/logger';
import prisma from './config/database';
import { partnerService } from './services/partner.services'; 

// Imports de types (type-only)
import type { Application, Request, Response, NextFunction } from 'express';
import refundRoutes from './routes/refund.routes';
import reportRoutes from './routes/report.routes';

// Charger les variables d'environnement
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

// ============================================
// MIDDLEWARE DE SÉCURITÉ
// ============================================

// Helmet pour la sécurité des headers HTTP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));

// CORS
const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5000'];
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? corsOrigins : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Signature', 'X-Timestamp', 'X-Api-Key', 'X-Api-Secret']
}));

// Rate limiting global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    error: 'Too many requests from this IP',
    code: 'RATE_LIMITED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', globalLimiter);

// ============================================
// MIDDLEWARE DE PARSING
// ============================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// MIDDLEWARE DE LOGGING
// ============================================

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  });
  
  next();
});

// ============================================
// FICHIERS STATIQUES
// ============================================

app.use(express.static(path.join(__dirname, '../public')));

// ============================================
// ROUTES API
// ============================================

app.use('/api/payments', paymentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/merchants', merchantRoutes); // ✅ Ajout des routes merchant
/**
 * @route   GET /docs/merchant-api
 * @desc    Documentation de l'API marchand
 * @access  Public
 */
app.get('/docs/merchant-api', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/docs/merchant-api.html'));
});

app.use('/api/reports', reportRoutes);

app.use('/api/refunds', refundRoutes);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      services: {
        database: 'connected',
        redis: process.env.REDIS_HOST ? 'configured' : 'not configured'
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({ 
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// PAGE DE PAIEMENT
// ============================================

app.get('/pay/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).send('Payment ID is required');
    }
    
    const payment = await prisma.payment.findUnique({
      where: { id: id }
    });
    
    if (!payment) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Paiement introuvable - Voaray</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              margin: 0;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .card {
              background: white;
              border-radius: 20px;
              padding: 40px;
              max-width: 500px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            }
            h1 { color: #dc3545; margin-bottom: 20px; }
            p { color: #666; line-height: 1.6; }
            .btn {
              display: inline-block;
              margin-top: 20px;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 10px;
              transition: transform 0.2s;
            }
            .btn:hover { transform: translateY(-2px); }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>❌ Paiement introuvable</h1>
            <p>Le paiement que vous recherchez n'existe pas ou a expiré.</p>
            <a href="/" class="btn">Retour à l'accueil</a>
          </div>
        </body>
        </html>
      `);
    }
    
    if (payment.status !== 'PENDING') {
      const isSuccess = payment.status === 'SUCCESS';
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${isSuccess ? 'Paiement réussi' : 'Paiement échoué'} - Voaray</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              margin: 0;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .card {
              background: white;
              border-radius: 20px;
              padding: 40px;
              max-width: 500px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            }
            .success { color: #28a745; }
            .error { color: #dc3545; }
            .amount { font-size: 32px; font-weight: bold; margin: 20px 0; }
            .btn {
              display: inline-block;
              margin-top: 20px;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 10px;
              transition: transform 0.2s;
            }
            .btn:hover { transform: translateY(-2px); }
          </style>
        </head>
        <body>
          <div class="card">
            <h1 class="${isSuccess ? 'success' : 'error'}">
              ${isSuccess ? '✅ Paiement réussi' : '❌ Paiement échoué'}
            </h1>
            <p>Ce paiement a déjà été ${payment.status === 'SUCCESS' ? 'confirmé avec succès' : payment.status === 'FAILED' ? 'échoué' : payment.status.toLowerCase()}.</p>
            <div class="amount">${payment.amount.toLocaleString()} Ar</div>
            <p><strong>Commande :</strong> ${payment.orderId}</p>
            ${payment.transactionId ? `<p><strong>Transaction :</strong> ${payment.transactionId}</p>` : ''}
            <a href="/" class="btn">Retour à l'accueil</a>
          </div>
        </body>
        </html>
      `);
    }
    
    res.sendFile(path.join(__dirname, '../public/payment.html'));
    
  } catch (error) {
    logger.error('Error serving payment page:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erreur - Voaray</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        </style>
      </head>
      <body>
        <h1>Erreur interne</h1>
        <p>Une erreur est survenue. Veuillez réessayer plus tard.</p>
      </body>
      </html>
    `);
  }
});

// ============================================
// PAGE D'ACCUEIL
// ============================================

app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Voaray Payment Gateway API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      payments: '/api/payments',
      webhooks: '/api/webhooks',
      admin: '/api/admin',
      merchants: '/api/merchants', // ✅ Ajout des endpoints merchants
      payment_page: '/pay/:id'
    },
    documentation: 'https://docs.voaray.com'
  });
});

// ============================================
// 404 HANDLER
// ============================================

app.use(notFound);

// ============================================
// ERROR HANDLER
// ============================================

app.use(errorHandler);

// ============================================
// DÉMARRAGE DU SERVEUR AVEC INITIALISATION DES PARTENAIRES
// ============================================

const startServer = async () => {
  try {
    await prisma.$connect();
    logger.info('📦 Database connected successfully');
    
    // ✅ Initialiser les partenaires au démarrage
    await partnerService.initializePartners();
    logger.info('🤝 Partners service initialized');
    
    app.listen(PORT, () => {
      logger.info(`🚀 Voaray API running on port ${PORT}`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Base URL: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
      logger.info(`💳 Payment URL: ${process.env.BASE_URL || `http://localhost:${PORT}`}/pay/{payment_id}`);
      logger.info(`🏥 Health check: ${process.env.BASE_URL || `http://localhost:${PORT}`}/health`);
      logger.info(`👥 Merchants API: ${process.env.BASE_URL || `http://localhost:${PORT}`}/api/merchants`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const shutdown = async (signal: string) => {
  logger.info(`${signal} signal received: closing HTTP server`);
  
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;