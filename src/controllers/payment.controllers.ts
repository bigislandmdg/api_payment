import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { processMobileMoneyPayment } from '../services/mobile-money.services';
import { updateShopifyOrder } from '../services/shopify.services';
import { sendNotification } from '../services/notification.services';
import logger from '../config/logger';
import { PaymentRequest, PaymentResponse } from '../types';

// Constante pour l'expiration en secondes (365 jours)
const EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60; // 31,536,000 secondes

export const createPayment = async (req: Request, res: Response) => {
  try {
    const { amount, order_id, phone, method, return_url } = req.body as PaymentRequest;

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
    expiresAt.setDate(expiresAt.getDate() + 365); // Ajoute 365 jours

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
          expiresAt: expiresAt, // 365 jours
          metadata: {
            return_url,
            ip_address: req.ip,
            user_agent: req.headers['user-agent']
          }
        }
      });

      logger.info(`Payment updated: ${updatedPayment.id} for order ${order_id} (expires in 365 days)`);

      const paymentUrl = `${process.env.BASE_URL}/pay/${updatedPayment.id}`;
      
      const response: PaymentResponse = {
        success: true,
        payment_id: updatedPayment.id,
        payment_url: paymentUrl,
        reference: updatedPayment.reference || undefined,
        expires_in: EXPIRES_IN_SECONDS // 31,536,000 secondes
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
        expiresAt: expiresAt, // 365 jours
        metadata: {
          return_url,
          ip_address: req.ip,
          user_agent: req.headers['user-agent']
        }
      }
    });

    logger.info(`Payment created: ${payment.id} for order ${order_id} (expires in 365 days)`);

    const paymentUrl = `${process.env.BASE_URL}/pay/${payment.id}`;
    
    const response: PaymentResponse = {
      success: true,
      payment_id: payment.id,
      payment_url: paymentUrl,
      reference: payment.reference || undefined,
      expires_in: EXPIRES_IN_SECONDS // 31,536,000 secondes
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

export const getPaymentStatus = async (req: Request, res: Response) => {
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
      created_at: payment.createdAt,
      completed_at: payment.completedAt,
      expires_at: payment.expiresAt // Ajout de la date d'expiration
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

    // Vérifier l'expiration (maintenant sur 365 jours)
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
          transactionId: result.transaction_id
        }
      });

      logger.info(`Payment confirmed: ${payment_id} for order ${payment.orderId}`);

      // Récupérer return_url du metadata
      const metadata = payment.metadata as any;
      const returnUrl = metadata?.return_url || `${process.env.BASE_URL}/success`;

      res.json({
        success: true,
        transaction_id: result.transaction_id,
        message: 'Payment confirmed successfully',
        redirect_url: returnUrl
      });
    } else {
      await prisma.payment.update({
        where: { id: payment_id },
        data: {
          status: 'FAILED',
          errorMessage: result.error
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