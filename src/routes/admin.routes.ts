import { Router } from 'express';
import { verifyJWT } from '../middleware/auth';
import prisma from '../config/database';
import logger from '../config/logger';

const router = Router();

// Toutes les routes admin nécessitent une authentification JWT
router.use(verifyJWT);

/**
 * @route   GET /api/admin/payments
 * @desc    Liste paginée des paiements avec filtres
 * @access  Admin
 * @query   page, limit, status, method, startDate, endDate
 */
router.get('/payments', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      method, 
      startDate, 
      endDate 
    } = req.query;
    
    const where: any = {};
    
    if (status) where.status = status;
    if (method) where.method = method;
    
    // Filtre par date
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: {
          transactions: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        }
      }),
      prisma.payment.count({ where })
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Error fetching payments:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   GET /api/admin/payments/:id
 * @desc    Détail d'un paiement avec ses transactions
 * @access  Admin
 * @params  id - ID du paiement
 */
router.get('/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' }
        },
        refunds: true,
        webhookLogs: {
          take: 20,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
        code: 'NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    logger.error('Error fetching payment details:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   GET /api/admin/stats
 * @desc    Statistiques globales des paiements
 * @access  Admin
 * @query   period (day, week, month, year)
 */
router.get('/stats', async (req, res) => {
  try {
    const { period = 'day' } = req.query;
    
    let dateFilter: Date | undefined;
    const now = new Date();
    
    switch (period) {
      case 'day':
        dateFilter = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        dateFilter = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        dateFilter = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        dateFilter = undefined;
    }

    const whereFilter = dateFilter ? { createdAt: { gte: dateFilter } } : {};

    const [
      totalPayments,
      successfulPayments,
      failedPayments,
      pendingPayments,
      totalAmount,
      totalFees,
      paymentsByMethod,
      paymentsByStatus
    ] = await Promise.all([
      prisma.payment.count({ where: whereFilter }),
      prisma.payment.count({ where: { ...whereFilter, status: 'SUCCESS' } }),
      prisma.payment.count({ where: { ...whereFilter, status: 'FAILED' } }),
      prisma.payment.count({ where: { ...whereFilter, status: 'PENDING' } }),
      prisma.payment.aggregate({
        where: { ...whereFilter, status: 'SUCCESS' },
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: { ...whereFilter, status: 'SUCCESS' },
        _sum: { fee: true }
      }),
      prisma.payment.groupBy({
        by: ['method'],
        where: { ...whereFilter, status: 'SUCCESS' },
        _count: true,
        _sum: { amount: true }
      }),
      prisma.payment.groupBy({
        by: ['status'],
        where: whereFilter,
        _count: true
      })
    ]);

    const successRate = totalPayments > 0 
      ? ((successfulPayments / totalPayments) * 100).toFixed(2)
      : '0';

    res.json({
      success: true,
      data: {
        period,
        summary: {
          total_payments: totalPayments,
          successful_payments: successfulPayments,
          failed_payments: failedPayments,
          pending_payments: pendingPayments,
          success_rate: `${successRate}%`,
          total_amount: totalAmount._sum.amount || 0,
          total_fees: totalFees._sum.fee || 0,
          net_amount: (totalAmount._sum.amount || 0) - (totalFees._sum.fee || 0),
          average_transaction: successfulPayments > 0 
            ? (totalAmount._sum.amount || 0) / successfulPayments 
            : 0
        },
        by_method: paymentsByMethod.map((m: { method: any; _count: any; _sum: { amount: any; }; }) => ({
          method: m.method,
          count: m._count,
          total_amount: m._sum.amount || 0
        })),
        by_status: paymentsByStatus.map((s: { status: any; _count: any; }) => ({
          status: s.status,
          count: s._count
        }))
      }
    });
  } catch (error) {
    logger.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   GET /api/admin/webhooks
 * @desc    Liste des logs de webhooks
 * @access  Admin
 * @query   page, limit, source, event
 */
router.get('/webhooks', async (req, res) => {
  try {
    const { page = 1, limit = 50, source, event } = req.query;
    
    const where: any = {};
    if (source) where.source = source;
    if (event) where.event = event;

    const [logs, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit)
      }),
      prisma.webhookLog.count({ where })
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Error fetching webhook logs:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   GET /api/admin/merchants
 * @desc    Liste des marchands (API Keys)
 * @access  Admin
 */
router.get('/merchants', async (req, res) => {
  try {
    const merchants = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        merchantId: true,
        merchantName: true,
        email: true,
        active: true,
        rateLimit: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      data: merchants
    });
  } catch (error) {
    logger.error('Error fetching merchants:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   POST /api/admin/merchants
 * @desc    Créer une nouvelle clé API
 * @access  Admin
 * @body    { name, merchantName, email, expiresIn }
 */
router.post('/merchants', async (req, res) => {
  try {
    const { name, merchantName, email, expiresIn = 365 } = req.body;
    
    // Importer crypto dynamiquement
    const crypto = await import('crypto');
    
    const apiKey = `voaray_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const merchantId = crypto.randomBytes(8).toString('hex');
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresIn);

    const newApiKey = await prisma.apiKey.create({
      data: {
        name,
        key: apiKey,
        secret: apiSecret,
        merchantId,
        merchantName,
        email,
        expiresAt,
        permissions: ['payments.create', 'payments.read', 'payments.confirm'],
        active: true
      }
    });

    res.json({
      success: true,
      data: {
        id: newApiKey.id,
        key: apiKey,
        secret: apiSecret,
        name,
        merchantName,
        email,
        expiresAt
      }
    });
  } catch (error) {
    logger.error('Error creating API key:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   PUT /api/admin/merchants/:id/status
 * @desc    Activer/Désactiver une clé API
 * @access  Admin
 * @params  id - ID de la clé API
 * @body    { active }
 */
router.put('/merchants/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const updated = await prisma.apiKey.update({
      where: { id },
      data: { active: active === true }
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        active: updated.active
      }
    });
  } catch (error) {
    logger.error('Error updating API key status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   DELETE /api/admin/merchants/:id
 * @desc    Supprimer une clé API
 * @access  Admin
 * @params  id - ID de la clé API
 */
router.delete('/merchants/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.apiKey.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'API key deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting API key:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * @route   GET /api/admin/audit
 * @desc    Liste des logs d'audit
 * @access  Admin
 * @query   page, limit, entity, action
 */
router.get('/audit', async (req, res) => {
  try {
    const { page = 1, limit = 50, entity, action } = req.query;
    
    const where: any = {};
    if (entity) where.entity = entity;
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit)
      }),
      prisma.auditLog.count({ where })
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Error fetching audit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

export default router;