import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { processMobileMoneyPayment } from '../services/mobile-money.services';
import { updateShopifyOrder } from '../services/shopify.services';
import { sendNotification } from '../services/notification.services';
import { feeService } from '../services/fee.services';
import { partnerService } from '../services/partner.services';
import logger from '../config/logger';
import { PaymentRequest, PaymentResponse, FilterParams } from '../types';

// Constante pour l'expiration en secondes (365 jours)
const EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60; // 31,536,000 secondes

export const createPayment = async (req: Request, res: Response) => {
  try {
    const { amount, order_id, phone, method, return_url, merchant_id } = req.body as PaymentRequest & { merchant_id?: string };

    // Validation
    if (!amount || !order_id || !phone || !method) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }

    // Vérifier que le montant est un nombre valide
    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount',
        code: 'INVALID_AMOUNT'
      });
    }

    // Valider la méthode de paiement
    const validMethods = ['MVOLA', 'ORANGE', 'AIRTEL'];
    const normalizedMethod = method.toUpperCase();
    
    if (!validMethods.includes(normalizedMethod)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment method. Must be MVOLA, ORANGE, or AIRTEL',
        code: 'INVALID_METHOD'
      });
    }

    // Vérifier que le partenaire est actif
    try {
      await partnerService.getPartner(normalizedMethod);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Partner not available',
        code: 'PARTNER_UNAVAILABLE'
      });
    }

    // Calculer les frais
    const feeResult = await feeService.calculateFee(parsedAmount, normalizedMethod, merchant_id);
    
    // Vérifier les limites de montant
    const amountValidation = feeService.validateAmount(parsedAmount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: amountValidation.message,
        code: 'INVALID_AMOUNT'
      });
    }

    // Vérifier si un paiement existe déjà pour cette commande
    const existingPayment = await prisma.payment.findUnique({
      where: { orderId: order_id }
    });

    // Si le paiement existe déjà et est réussi
    if (existingPayment && existingPayment.status === 'SUCCESS') {
      return res.status(400).json({
        success: false,
        error: 'Order already paid',
        code: 'ALREADY_PAID'
      });
    }

    // Calculer la date d'expiration (365 jours)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);

    // Si le paiement existe mais n'est pas réussi (PENDING, FAILED, etc.)
    if (existingPayment) {
      // Mettre à jour le paiement existant
      const updatedPayment = await prisma.payment.update({
        where: { id: existingPayment.id },
        data: {
          amount: parsedAmount,
          phone,
          method: normalizedMethod as any,
          status: 'PENDING',
          reference: uuidv4(),
          expiresAt: expiresAt,
          fee: feeResult.total,
          netAmount: feeResult.net,
          metadata: {
            return_url,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            merchant_id,
            fee_breakdown: feeResult.breakdown
          }
        }
      });

      logger.info(`Payment updated: ${updatedPayment.id} for order ${order_id}`, {
        amount: parsedAmount,
        fee: feeResult.total,
        net: feeResult.net
      });

      const paymentUrl = `${process.env.BASE_URL}/pay/${updatedPayment.id}`;
      
      const response: PaymentResponse = {
        success: true,
        payment_id: updatedPayment.id,
        payment_url: paymentUrl,
        reference: updatedPayment.reference || undefined,
        expires_in: EXPIRES_IN_SECONDS,
        fees: {
          total: feeResult.total,
          net: feeResult.net,
          breakdown: feeResult.breakdown
        }
      };

      return res.json(response);
    }

    // Créer un nouveau paiement
    const payment = await prisma.payment.create({
      data: {
        orderId: order_id,
        amount: parsedAmount,
        phone,
        method: normalizedMethod as any,
        status: 'PENDING',
        reference: uuidv4(),
        expiresAt: expiresAt,
        fee: feeResult.total,
        netAmount: feeResult.net,
        metadata: {
          return_url,
          ip_address: req.ip,
          user_agent: req.headers['user-agent'],
          merchant_id,
          fee_breakdown: feeResult.breakdown
        }
      }
    });

    logger.info(`Payment created: ${payment.id} for order ${order_id}`, {
      amount: parsedAmount,
      fee: feeResult.total,
      net: feeResult.net,
      partner: normalizedMethod
    });

    const paymentUrl = `${process.env.BASE_URL}/pay/${payment.id}`;
    
    const response: PaymentResponse = {
      success: true,
      payment_id: payment.id,
      payment_url: paymentUrl,
      reference: payment.reference || undefined,
      expires_in: EXPIRES_IN_SECONDS,
      fees: {
        total: feeResult.total,
        net: feeResult.net,
        breakdown: feeResult.breakdown
      }
    };

    res.json(response);

  } catch (error) {
    logger.error('Error creating payment:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};

export const getAllPayments = async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      method,
    
      orderId,
      phone,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query as FilterParams & {
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };

    // Construire les filtres
    const where: any = {};
    
    if (status) where.status = status;
    if (method) where.method = method;
    if (orderId) where.orderId = orderId;
    if (phone) where.phone = { contains: phone };
    
    

    // Validation des paramètres de pagination
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Construction de l'ordre de tri
    const orderBy: any = {};
    const validSortFields = ['createdAt', 'amount', 'status', 'method', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'createdAt';
    orderBy[sortField as string] = sortOrder === 'asc' ? 'asc' : 'desc';

    // Exécuter les requêtes en parallèle
    const [payments, total, stats] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include: {
          transactions: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        }
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({
        where,
        _sum: {
          amount: true,
          fee: true,
          netAmount: true
        },
        _count: true
      })
    ]);

    // Calculer le montant total des frais
    const totalAmount = stats._sum.amount || 0;
    const totalFees = stats._sum.fee || 0;
    const totalNet = stats._sum.netAmount || 0;

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum * limitNum < total,
        hasPrev: pageNum > 1
      },
      summary: {
        total_amount: totalAmount,
        total_fees: totalFees,
        total_net: totalNet,
        average_transaction: total > 0 ? totalAmount / total : 0,
        average_fee: total > 0 ? totalFees / total : 0
      }
    });

  } catch (error) {
    logger.error('Error fetching all payments:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};

export const getPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        transactions: {
          take: 1,
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
      payment_id: payment.id,
      order_id: payment.orderId,
      amount: payment.amount,
      status: payment.status,
      method: payment.method,
      phone: payment.phone,
      transaction_id: payment.transactionId,
      reference: payment.reference,
      fee: payment.fee,
      net_amount: payment.netAmount,
      created_at: payment.createdAt,
      completed_at: payment.completedAt,
      expires_at: payment.expiresAt
    });

  } catch (error) {
    logger.error('Error getting payment status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};

export const confirmPayment = async (req: Request, res: Response) => {
  try {
    const { payment_id, confirmation_code, otp } = req.body;

    if (!payment_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment ID is required',
        code: 'MISSING_PAYMENT_ID'
      });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: payment_id }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
        code: 'NOT_FOUND'
      });
    }

    if (payment.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        error: `Payment already ${payment.status}`,
        code: 'INVALID_STATUS'
      });
    }

    // Vérifier l'expiration
    if (payment.expiresAt && new Date() > payment.expiresAt) {
      await prisma.payment.update({
        where: { id: payment_id },
        data: { status: 'EXPIRED' }
      });
      return res.status(400).json({
        success: false,
        error: 'Payment session expired (after 365 days)',
        code: 'SESSION_EXPIRED'
      });
    }

    // Vérifier que le partenaire est toujours actif
    try {
      await partnerService.getPartner(payment.method as string);
    } catch (error) {
      await prisma.payment.update({
        where: { id: payment_id },
        data: { status: 'FAILED', errorMessage: 'Partner unavailable' }
      });
      return res.status(400).json({
        success: false,
        error: 'Payment service temporarily unavailable',
        code: 'PARTNER_UNAVAILABLE'
      });
    }

    // Mettre à jour le statut en traitement
    await prisma.payment.update({
      where: { id: payment_id },
      data: { status: 'PROCESSING' }
    });

    // Traiter le paiement
    const result = await processMobileMoneyPayment(payment, confirmation_code || otp);

    if (result.success) {
      const updatedPayment = await prisma.payment.update({
        where: { id: payment_id },
        data: {
          status: 'SUCCESS',
          transactionId: result.transaction_id,
          completedAt: new Date()
        }
      });

      // Enregistrer la transaction détaillée
      await prisma.transaction.create({
        data: {
          paymentId: payment.id,
          type: 'PAYMENT',
          provider: payment.method,
          providerRef: result.transaction_id || '',
          amount: payment.amount,
          fee: payment.fee || 0,
          netAmount: payment.netAmount || payment.amount,
          status: 'SUCCESS',
          responseData: result.provider_response
        }
      });

      // Mettre à jour Shopify
      await updateShopifyOrder(payment.orderId, 'SUCCESS');

      // Envoyer la notification de succès
      await sendNotification({
        phone: payment.phone,
        type: 'payment_success',
        message: `Payment of ${payment.amount} Ar confirmed successfully.`,
        metadata: {
          amount: payment.amount,
          orderId: payment.orderId,
          transactionId: result.transaction_id,
          fees: payment.fee,
          netAmount: payment.netAmount
        }
      });

      logger.info(`Payment confirmed: ${payment_id} for order ${payment.orderId}`, {
        amount: payment.amount,
        fee: payment.fee,
        net: payment.netAmount,
        transaction_id: result.transaction_id
      });

      // Récupérer return_url du metadata
      const metadata = payment.metadata as any;
      const returnUrl = metadata?.return_url || `${process.env.BASE_URL}/success`;

      res.json({
        success: true,
        transaction_id: result.transaction_id,
        message: 'Payment confirmed successfully',
        redirect_url: returnUrl,
        fee: payment.fee,
        net_amount: payment.netAmount
      });
    } else {
      await prisma.payment.update({
        where: { id: payment_id },
        data: {
          status: 'FAILED',
          errorMessage: result.error
        }
      });

      // Enregistrer la transaction échouée
      await prisma.transaction.create({
        data: {
          paymentId: payment.id,
          type: 'PAYMENT',
          provider: payment.method,
          providerRef: result.transaction_id || '',
          amount: payment.amount,
          fee: payment.fee || 0,
          netAmount: payment.netAmount || payment.amount,
          status: 'FAILED',
          responseData: { error: result.error }
        }
      });

      // Envoyer la notification d'échec
      await sendNotification({
        phone: payment.phone,
        type: 'payment_failed',
        message: result.error || 'Payment failed',
        metadata: {
          amount: payment.amount,
          orderId: payment.orderId
        }
      });

      res.status(400).json({
        success: false,
        error: result.error,
        code: 'PAYMENT_FAILED'
      });
    }

  } catch (error) {
    logger.error('Error confirming payment:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};

export const getPaymentFees = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
        code: 'NOT_FOUND'
      });
    }

    const feeBreakdown = await feeService.calculateFeeBreakdown(
      payment.amount,
      payment.method,
      (payment.metadata as any)?.merchant_id
    );

    res.json({
      success: true,
      data: {
        gross_amount: payment.amount,
        fee: payment.fee,
        net_amount: payment.netAmount,
        breakdown: (payment.metadata as any)?.fee_breakdown || feeBreakdown
      }
    });
  } catch (error) {
    logger.error('Error getting payment fees:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};