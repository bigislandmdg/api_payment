import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../config/logger';

export class MerchantController {
  
  /**
   * Créer un nouveau marchand avec sa clé API
   */
  async createMerchant(req: Request, res: Response) {
    try {
      const { name, email, company, plan, phone, webhookUrl } = req.body;
      
      // Validation
      if (!name || !email) {
        return res.status(400).json({
          success: false,
          error: 'Name and email are required',
          code: 'MISSING_FIELDS'
        });
      }
      
      // Vérifier si l'email existe déjà
      const existingMerchant = await prisma.merchant.findUnique({
        where: { email }
      });
      
      if (existingMerchant) {
        return res.status(400).json({
          success: false,
          error: 'Email already registered',
          code: 'EMAIL_EXISTS'
        });
      }
      
      // Générer les clés API
      const apiKey = `voaray_${crypto.randomBytes(24).toString('hex')}`;
      const apiSecret = crypto.randomBytes(32).toString('hex');
      
      // Date d'expiration (365 jours)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 365);
      
      // Créer les settings
      const settings = {
        plan: plan || 'BASIC',
        webhookUrl: webhookUrl || null,
        createdAt: new Date().toISOString()
      };
      
      // Créer le marchand avec sa clé API
      // ⚠️ IMPORTANT: Ne PAS spécifier merchantId manuellement
      // Prisma le gère automatiquement via la relation
      const merchant = await prisma.merchant.create({
        data: {
          name,
          email,
          phone: phone || null,
          companyName: company || name,
          settings: settings,
          active: true,
          apiKeys: {
            create: {
              key: apiKey,
              secret: apiSecret,
              name: 'Default API Key',
              merchantName: name,
              email,
              permissions: ['payments.create', 'payments.read', 'payments.confirm'],
              rateLimit: 100,
              expiresAt
            }
          }
        },
        include: {
          apiKeys: true
        }
      });
      
      logger.info(`New merchant created: ${merchant.name} (${merchant.email})`);
      
      // Extraire le plan des settings de manière sécurisée
      const merchantSettings = merchant.settings as any;
      const merchantPlan = merchantSettings?.plan || 'BASIC';
      
      // Récupérer la clé API créée
      const createdApiKey = merchant.apiKeys[0];
      
      res.json({
        success: true,
        data: {
          merchantId: merchant.id,
          name: merchant.name,
          email: merchant.email,
          companyName: merchant.companyName,
          plan: merchantPlan,
          apiKey: createdApiKey?.key,
          apiSecret: createdApiKey?.secret,
          endpoints: {
            createPayment: `${process.env.BASE_URL}/api/v1/payments`,
            getStatus: `${process.env.BASE_URL}/api/v1/payments/:id`,
            confirmPayment: `${process.env.BASE_URL}/api/v1/payments/confirm`,
            webhookUrl: `${process.env.BASE_URL}/api/webhooks/merchant`
          },
          documentation: `${process.env.BASE_URL}/docs/merchant-api`
        }
      });
      
    } catch (error) {
      logger.error('Error creating merchant:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  }
  
  /**
   * Récupérer les statistiques du marchand
   */
  async getMerchantStats(req: Request, res: Response) {
    try {
      const merchantId = req.merchantId;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      // Récupérer le marchand
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId }
      });
      
      if (!merchant) {
        return res.status(404).json({
          success: false,
          error: 'Merchant not found',
          code: 'NOT_FOUND'
        });
      }
      
      // Extraire le plan des settings de manière sécurisée
      const merchantSettings = merchant.settings as any;
      const merchantPlan = merchantSettings?.plan || 'BASIC';
      
      // Statistiques des 30 derniers jours
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Statistiques globales
      const stats = await prisma.payment.aggregate({
        where: {
          metadata: {
            path: ['merchant_id'],
            equals: merchantId
          },
          status: 'SUCCESS',
          createdAt: { gte: thirtyDaysAgo }
        },
        _count: true,
        _sum: { amount: true, fee: true, netAmount: true }
      });
      
      // Statistiques par méthode de paiement
      const methodStats = await prisma.payment.groupBy({
        by: ['method'],
        where: {
          metadata: {
            path: ['merchant_id'],
            equals: merchantId
          },
          status: 'SUCCESS',
          createdAt: { gte: thirtyDaysAgo }
        },
        _count: true,
        _sum: { amount: true, fee: true }
      });
      
      const totalTransactions = stats._count;
      const totalVolume = stats._sum.amount || 0;
      const totalFees = stats._sum.fee || 0;
      const netVolume = stats._sum.netAmount || (totalVolume - totalFees);
      
      // Calculer le taux de succès
      const totalAttempts = await prisma.payment.count({
        where: {
          metadata: {
            path: ['merchant_id'],
            equals: merchantId
          },
          createdAt: { gte: thirtyDaysAgo }
        }
      });
      
      const successRate = totalAttempts > 0 
        ? (totalTransactions / totalAttempts) * 100 
        : 0;
      
      res.json({
        success: true,
        data: {
          merchant: {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email,
            companyName: merchant.companyName,
            plan: merchantPlan,
            active: merchant.active,
            createdAt: merchant.createdAt
          },
          summary: {
            period: 'Last 30 days',
            total_transactions: totalTransactions,
            total_volume: totalVolume,
            total_fees: totalFees,
            net_volume: netVolume,
            success_rate: `${successRate.toFixed(2)}%`,
            average_transaction: totalTransactions > 0 
              ? totalVolume / totalTransactions 
              : 0,
            average_fee: totalTransactions > 0 
              ? totalFees / totalTransactions 
              : 0
          },
          by_method: methodStats.map(m => ({
            method: m.method,
            count: m._count,
            volume: m._sum.amount || 0,
            fees: m._sum.fee || 0
          }))
        }
      });
      
    } catch (error) {
      logger.error('Error fetching merchant stats:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  }
  
  /**
   * Récupérer les informations du marchand
   */
  async getMerchantInfo(req: Request, res: Response) {
    try {
      const merchantId = req.merchantId;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: {
          apiKeys: {
            select: {
              id: true,
              name: true,
              key: true,
              active: true,
              rateLimit: true,
              lastUsedAt: true,
              expiresAt: true,
              createdAt: true
            }
          }
        }
      });
      
      if (!merchant) {
        return res.status(404).json({
          success: false,
          error: 'Merchant not found',
          code: 'NOT_FOUND'
        });
      }
      
      res.json({
        success: true,
        data: {
          id: merchant.id,
          name: merchant.name,
          email: merchant.email,
          phone: merchant.phone,
          companyName: merchant.companyName,
          taxId: merchant.taxId,
          settings: merchant.settings,
          webhookUrl: merchant.webhookUrl,
          active: merchant.active,
          apiKeys: merchant.apiKeys,
          createdAt: merchant.createdAt,
          updatedAt: merchant.updatedAt
        }
      });
      
    } catch (error) {
      logger.error('Error fetching merchant info:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  }
  
  /**
   * Mettre à jour les informations du marchand
   */
  async updateMerchant(req: Request, res: Response) {
    try {
      const merchantId = req.merchantId;
      const { name, phone, companyName, taxId, webhookUrl, settings } = req.body;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      const updatedMerchant = await prisma.merchant.update({
        where: { id: merchantId },
        data: {
          name: name,
          phone: phone,
          companyName: companyName,
          taxId: taxId,
          webhookUrl: webhookUrl,
          settings: settings ? settings : undefined
        }
      });
      
      logger.info(`Merchant updated: ${updatedMerchant.id}`);
      
      res.json({
        success: true,
        data: updatedMerchant
      });
      
    } catch (error) {
      logger.error('Error updating merchant:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  }
  
  /**
   * Régénérer une clé API
   */
  async regenerateApiKey(req: Request, res: Response) {
    try {
      const merchantId = req.merchantId;
      const { keyId } = req.params;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      const newApiKey = `voaray_${crypto.randomBytes(24).toString('hex')}`;
      const newApiSecret = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 365);
      
      // Vérifier que la clé appartient bien au marchand
      const existingKey = await prisma.apiKey.findFirst({
        where: {
          id: keyId,
          merchantId: merchantId
        }
      });
      
      if (!existingKey) {
        return res.status(404).json({
          success: false,
          error: 'API key not found',
          code: 'NOT_FOUND'
        });
      }
      
      const updatedKey = await prisma.apiKey.update({
        where: { id: keyId },
        data: {
          key: newApiKey,
          secret: newApiSecret,
          expiresAt
        }
      });
      
      logger.info(`API key regenerated for merchant ${merchantId}`);
      
      res.json({
        success: true,
        data: {
          key: updatedKey.key,
          secret: newApiSecret,
          expiresAt: updatedKey.expiresAt
        }
      });
      
    } catch (error) {
      logger.error('Error regenerating API key:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  }
  
  /**
   * Récupérer la liste des transactions du marchand
   */
  async getMerchantTransactions(req: Request, res: Response) {
    try {
      const merchantId = req.merchantId;
      const { page = 1, limit = 50, status, startDate, endDate } = req.query;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      const where: any = {
        metadata: {
          path: ['merchant_id'],
          equals: merchantId
        }
      };
      
      if (status) where.status = status;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate as string);
        if (endDate) where.createdAt.lte = new Date(endDate as string);
      }
      
      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip = (pageNum - 1) * limitNum;
      
      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
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
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      });
      
    } catch (error) {
      logger.error('Error fetching merchant transactions:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  }
}

export const merchantController = new MerchantController();