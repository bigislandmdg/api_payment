import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../config/logger';
import { webhookService } from '../services/webhook.services';
import { sendNotification } from '../services/notification.services';

export class RefundController {
  
  /**
   * Créer un remboursement pour un paiement
   */
  createRefund = async (req: Request, res: Response) => {
    try {
      const { payment_id, amount, reason, metadata } = req.body;
      
      // Validation
      if (!payment_id) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID is required',
          code: 'MISSING_PAYMENT_ID'
        });
      }
      
      // Récupérer le paiement avec ses transactions
      const payment = await prisma.payment.findUnique({
        where: { id: payment_id },
        include: {
          transactions: {
            where: { status: 'SUCCESS' },
            orderBy: { createdAt: 'desc' },
            take: 1
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
      
      // Vérifier si le paiement est éligible au remboursement
      if (payment.status !== 'SUCCESS') {
        return res.status(400).json({
          success: false,
          error: `Payment cannot be refunded. Current status: ${payment.status}`,
          code: 'NOT_ELIGIBLE_FOR_REFUND'
        });
      }
      
      // Vérifier si un remboursement existe déjà
      const existingRefund = await prisma.refund.findFirst({
        where: { paymentId: payment.id, status: 'SUCCESS' }
      });
      
      if (existingRefund) {
        return res.status(400).json({
          success: false,
          error: 'Payment already refunded',
          code: 'ALREADY_REFUNDED'
        });
      }
      
      // Déterminer le montant à rembourser
      const refundAmount = amount || payment.amount;
      
      if (refundAmount > payment.amount) {
        return res.status(400).json({
          success: false,
          error: `Refund amount (${refundAmount}) exceeds payment amount (${payment.amount})`,
          code: 'INVALID_REFUND_AMOUNT'
        });
      }
      
      // Récupérer la transaction associée
      const transaction = payment.transactions[0];
      if (!transaction) {
        return res.status(400).json({
          success: false,
          error: 'No transaction found for this payment',
          code: 'NO_TRANSACTION_FOUND'
        });
      }
      
      logger.info(`Processing refund for payment ${payment_id}, amount: ${refundAmount}`);
      
      // Traiter le remboursement auprès du provider
      const refundResult = await this.processRefundWithProvider(payment, transaction, refundAmount);
      
      if (refundResult.success) {
        // Utiliser une transaction Prisma pour la cohérence des données
        const result = await prisma.$transaction(async (tx) => {
          // Créer l'enregistrement de remboursement
          const refund = await tx.refund.create({
            data: {
              paymentId: payment.id,
              transactionId: transaction.id,
              amount: refundAmount,
              reason: reason || null,
              status: 'SUCCESS',
              providerRef: refundResult.providerRef,
              metadata: {
                ...metadata,
                processed_at: new Date().toISOString(),
                provider_response: refundResult.provider_response
              },
              processedAt: new Date()
            }
          });
          
          // Mettre à jour le statut du paiement
          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'REFUNDED'
            }
          });
          
          // Enregistrer la transaction de remboursement
          await tx.transaction.create({
            data: {
              paymentId: payment.id,
              type: 'REFUND',
              provider: payment.method,
              providerRef: refundResult.providerRef || '',
              amount: refundAmount,
              fee: 0,
              netAmount: refundAmount,
              status: 'SUCCESS',
              responseData: refundResult.provider_response
            }
          });
          
          return { refund, updatedPayment };
        });
        
        logger.info(`Refund processed successfully for payment ${payment_id}`, {
          refund_id: result.refund.id,
          amount: refundAmount,
          provider_ref: refundResult.providerRef
        });
        
        // Envoyer une notification de remboursement
        if (sendNotification) {
          await sendNotification({
            phone: payment.phone,
            email: (payment.metadata as any)?.email,
            type: 'payment_success',
            message: `A refund of ${refundAmount} Ar has been processed for your payment.`,
            metadata: {
              amount: refundAmount,
              orderId: payment.orderId,
              transactionId: result.refund.id,
              refund_amount: refundAmount
            }
          });
        }
        
        // Envoyer un webhook au marchand si configuré
        const merchantWebhookUrl = (payment.metadata as any)?.merchant_webhook_url;
        if (merchantWebhookUrl && webhookService) {
          const signature = this.generateRefundSignature(result.refund, payment);
          await webhookService.sendWithRetry(
            merchantWebhookUrl,
            {
              event: 'payment.refunded',
              payment_id: payment.id,
              order_id: payment.orderId,
              amount: payment.amount,
              refund_amount: refundAmount,
              refund_id: result.refund.id,
              status: 'REFUNDED',
              timestamp: new Date().toISOString()
            },
            signature,
            3
          );
        }
        
        res.json({
          success: true,
          data: {
            refund_id: result.refund.id,
            payment_id: payment.id,
            order_id: payment.orderId,
            amount: refundAmount,
            original_amount: payment.amount,
            status: 'SUCCESS',
            provider_ref: refundResult.providerRef,
            processed_at: new Date().toISOString()
          }
        });
        
      } else {
        // Enregistrer l'échec du remboursement
        await prisma.refund.create({
          data: {
            paymentId: payment.id,
            transactionId: transaction.id,
            amount: refundAmount,
            reason: reason || null,
            status: 'FAILED',
            providerRef: refundResult.providerRef,
            metadata: {
              error: refundResult.error,
              provider_response: refundResult.provider_response,
              attempted_at: new Date().toISOString()
            }
          }
        });
        
        logger.error(`Refund failed for payment ${payment_id}`, {
          error: refundResult.error,
          amount: refundAmount
        });
        
        res.status(400).json({
          success: false,
          error: refundResult.error || 'Refund processing failed',
          code: 'REFUND_FAILED',
          provider_response: refundResult.provider_response
        });
      }
      
    } catch (error) {
      logger.error('Error creating refund:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
  
  /**
   * Récupérer le statut d'un remboursement
   */
  getRefundStatus = async (req: Request, res: Response) => {
    try {
      const { refund_id } = req.params;
      
      if (!refund_id) {
        return res.status(400).json({
          success: false,
          error: 'Refund ID is required',
          code: 'MISSING_REFUND_ID'
        });
      }
      
      const refund = await prisma.refund.findUnique({
        where: { id: refund_id },
        include: {
          payment: {
            select: {
              id: true,
              orderId: true,
              amount: true,
              phone: true,
              method: true
            }
          }
        }
      });
      
      if (!refund) {
        return res.status(404).json({
          success: false,
          error: 'Refund not found',
          code: 'NOT_FOUND'
        });
      }
      
      res.json({
        success: true,
        data: {
          refund_id: refund.id,
          payment_id: refund.paymentId,
          order_id: refund.payment?.orderId,
          amount: refund.amount,
          reason: refund.reason,
          status: refund.status,
          provider_ref: refund.providerRef,
          created_at: refund.createdAt,
          processed_at: refund.processedAt
        }
      });
      
    } catch (error) {
      logger.error('Error fetching refund status:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  };
  
  /**
   * Récupérer tous les remboursements d'un paiement
   */
  getPaymentRefunds = async (req: Request, res: Response) => {
    try {
      const { payment_id } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      if (!payment_id) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID is required',
          code: 'MISSING_PAYMENT_ID'
        });
      }
      
      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip = (pageNum - 1) * limitNum;
      
      const [refunds, total] = await Promise.all([
        prisma.refund.findMany({
          where: { paymentId: payment_id },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.refund.count({ where: { paymentId: payment_id } })
      ]);
      
      res.json({
        success: true,
        data: refunds,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      });
      
    } catch (error) {
      logger.error('Error fetching payment refunds:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  };
  
  /**
   * Traiter le remboursement avec le provider (MVola, Orange, Airtel)
   */
  private processRefundWithProvider = async (
    payment: any, 
    transaction: any, 
    amount: number
  ): Promise<{
    success: boolean;
    providerRef?: string;
    error?: string;
    provider_response?: any;
  }> => {
    try {
      // Simulation pour le développement
      if (process.env.NODE_ENV === 'development') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Simuler un succès à 90%
        if (Math.random() > 0.1) {
          return {
            success: true,
            providerRef: `REF_${Date.now()}_${payment.id}`,
            provider_response: {
              status: 'SUCCESS',
              message: 'Refund processed successfully',
              refund_id: `REF_${Date.now()}`,
              timestamp: new Date().toISOString()
            }
          };
        } else {
          return {
            success: false,
            error: 'Provider refund failed: Insufficient balance',
            provider_response: {
              status: 'FAILED',
              error: 'INSUFFICIENT_BALANCE',
              message: 'Insufficient balance for refund'
            }
          };
        }
      }
      
      // Production - Appeler l'API du provider selon la méthode de paiement
      switch (payment.method) {
        case 'MVOLA':
          return await this.processMvolaRefund(payment, transaction, amount);
        case 'ORANGE':
          return await this.processOrangeRefund(payment, transaction, amount);
        case 'AIRTEL':
          return await this.processAirtelRefund(payment, transaction, amount);
        default:
          return {
            success: false,
            error: `Unsupported payment method for refund: ${payment.method}`
          };
      }
      
    } catch (error) {
      logger.error('Error processing refund with provider:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Provider refund failed',
        provider_response: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  };
  
  /**
   * Traiter un remboursement MVola
   */
  private processMvolaRefund = async (payment: any, transaction: any, amount: number): Promise<any> => {
    // Implémentation MVola
    // TODO: Intégrer l'API MVola pour les remboursements
    return {
      success: true,
      providerRef: `MVOLA_REF_${Date.now()}`,
      provider_response: { status: 'PENDING', message: 'Refund initiated' }
    };
  };
  
  /**
   * Traiter un remboursement Orange Money
   */
  private processOrangeRefund = async (payment: any, transaction: any, amount: number): Promise<any> => {
    // Implémentation Orange Money
    // TODO: Intégrer l'API Orange Money pour les remboursements
    return {
      success: true,
      providerRef: `ORANGE_REF_${Date.now()}`,
      provider_response: { status: 'PENDING', message: 'Refund initiated' }
    };
  };
  
  /**
   * Traiter un remboursement Airtel Money
   */
  private processAirtelRefund = async (payment: any, transaction: any, amount: number): Promise<any> => {
    // Implémentation Airtel Money
    // TODO: Intégrer l'API Airtel Money pour les remboursements
    return {
      success: true,
      providerRef: `AIRTEL_REF_${Date.now()}`,
      provider_response: { status: 'PENDING', message: 'Refund initiated' }
    };
  };
  
  /**
   * Générer une signature HMAC pour le webhook de remboursement
   */
  private generateRefundSignature = (refund: any, payment: any): string => {
    const payload = {
      refund_id: refund.id,
      payment_id: payment.id,
      order_id: payment.orderId,
      amount: refund.amount,
      status: refund.status,
      timestamp: new Date().toISOString()
    };
    
    return crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET || 'default-secret')
      .update(JSON.stringify(payload))
      .digest('hex');
  };
}

export const refundController = new RefundController();