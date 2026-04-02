import { Request, Response } from 'express';
import crypto from 'crypto'; // ✅ Importer crypto correctement
import prisma from '../config/database';
import { updateShopifyOrder } from '../services/shopify.services';
import { sendNotification } from '../services/notification.services';
import { webhookService } from '../services/webhook.services';
import logger from '../config/logger';

export const handleMobileMoneyWebhook = async (req: Request, res: Response) => {
  try {
    const { transaction_id, status, payment_id, amount, phone } = req.body;

    // Vérifier si le payment existe avant de créer le log
    let existingPayment = null;
    if (payment_id) {
      existingPayment = await prisma.payment.findFirst({
        where: {
          OR: [
            { id: payment_id },
            { transactionId: transaction_id },
            { reference: payment_id }
          ]
        }
      });
    }

    // Créer le log seulement si le paiement existe
    if (existingPayment) {
      await prisma.webhookLog.create({
        data: {
          paymentId: existingPayment.id,
          event: 'PAYMENT_CONFIRMED',
          source: 'mobile_money',
          payload: req.body,
          statusCode: 200,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      });
    } else {
      logger.warn(`Webhook received for unknown payment: ${payment_id}`);
    }

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { id: payment_id },
          { transactionId: transaction_id },
          { reference: payment_id }
        ]
      }
    });

    if (!payment) {
      logger.warn(`Webhook received for unknown payment: ${payment_id}`);
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (payment.status === 'SUCCESS') {
      return res.json({ success: true, message: 'Payment already processed' });
    }

    if (status === 'SUCCESS') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          transactionId: transaction_id,
          completedAt: new Date()
        }
      });

      await updateShopifyOrder(payment.orderId, 'SUCCESS');
      
      await sendNotification({
        phone: payment.phone,
        type: 'payment_success',
        message: `Payment of ${payment.amount} Ar confirmed successfully.`,
        metadata: {
          amount: payment.amount,
          orderId: payment.orderId,
          transactionId: transaction_id
        }
      });

      logger.info(`Webhook processed: Payment ${payment.id} successful`);

      // Envoyer un webhook de notification au marchand si configuré
      const merchantWebhookUrl = (payment.metadata as any)?.merchant_webhook_url;
      if (merchantWebhookUrl) {
        const signature = generateWebhookSignature(payment);
        await webhookService.sendWithRetry(
          merchantWebhookUrl,
          {
            event: 'payment.success',
            payment_id: payment.id,
            order_id: payment.orderId,
            amount: payment.amount,
            transaction_id: transaction_id,
            status: 'SUCCESS',
            timestamp: new Date().toISOString()
          },
          signature,
          3
        );
      }
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          errorMessage: `Transaction failed: ${status}`
        }
      });

      logger.warn(`Webhook processed: Payment ${payment.id} failed`);

      // Envoyer un webhook de notification d'échec au marchand
      const merchantWebhookUrl = (payment.metadata as any)?.merchant_webhook_url;
      if (merchantWebhookUrl) {
        const signature = generateWebhookSignature(payment);
        await webhookService.sendWithRetry(
          merchantWebhookUrl,
          {
            event: 'payment.failed',
            payment_id: payment.id,
            order_id: payment.orderId,
            amount: payment.amount,
            status: 'FAILED',
            error: `Transaction failed: ${status}`,
            timestamp: new Date().toISOString()
          },
          signature,
          3
        );
      }
    }

    res.json({ success: true, message: 'Webhook processed successfully' });

  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const handleShopifyWebhook = async (req: Request, res: Response) => {
  try {
    const topic = req.headers['x-shopify-topic'] as string;
    const { id, total_price, customer } = req.body;

    logger.info(`Shopify webhook received: ${topic} for order ${id}`);

    // Vérifier si un paiement existe pour cette commande
    let existingPayment = null;
    if (id) {
      existingPayment = await prisma.payment.findUnique({
        where: { orderId: id.toString() }
      });
    }

    // Créer le log seulement si un paiement existe
    if (existingPayment) {
      await prisma.webhookLog.create({
        data: {
          paymentId: existingPayment.id,
          event: topic === 'orders/create' ? 'SHOPIFY_ORDER_CREATED' : 'SHOPIFY_ORDER_PAID',
          source: 'shopify',
          payload: req.body,
          statusCode: 200,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      });

      // Si une commande est payée via Shopify, vérifier si le paiement est déjà traité
      if (topic === 'orders/paid' && existingPayment.status !== 'SUCCESS') {
        logger.info(`Order ${id} marked as paid in Shopify, updating payment status`);
        
        await prisma.payment.update({
          where: { id: existingPayment.id },
          data: {
            status: 'SUCCESS',
            completedAt: new Date(),
            metadata: {
              ...(existingPayment.metadata as any),
              shopify_webhook: {
                topic,
                received_at: new Date().toISOString()
              }
            }
          }
        });

        // Envoyer une notification de succès
        await sendNotification({
          phone: existingPayment.phone,
          type: 'payment_success',
          message: `Payment of ${existingPayment.amount} Ar confirmed via Shopify.`,
          metadata: {
            amount: existingPayment.amount,
            orderId: existingPayment.orderId
          }
        });
      }
    } else {
      // Logger dans un fichier séparé pour les webhooks sans paiement associé
      const fs = require('fs');
      const logDir = 'logs';
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
      }
      
      const logEntry = {
        timestamp: new Date().toISOString(),
        topic,
        orderId: id,
        data: {
          id,
          total_price,
          customer_email: customer?.email
        }
      };
      
      fs.appendFileSync(
        'logs/shopify-webhooks.log', 
        JSON.stringify(logEntry) + '\n'
      );
      
      logger.info(`Shopify webhook logged to file for order ${id} (no payment associated)`);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error processing Shopify webhook:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Génère une signature HMAC pour les webhooks
 */
const generateWebhookSignature = (payment: any): string => {
  const payload = {
    payment_id: payment.id,
    order_id: payment.orderId,
    amount: payment.amount,
    status: payment.status,
    timestamp: new Date().toISOString()
  };
  
  return crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET || 'default-secret')
    .update(JSON.stringify(payload))
    .digest('hex');
};

/**
 * Envoie un webhook de test pour vérifier la configuration
 */
export const testMerchantWebhook = async (req: Request, res: Response) => {
  try {
    const { url, merchant_id } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL is required',
        code: 'MISSING_URL'
      });
    }

    const testPayload = {
      event: 'test',
      message: 'This is a test webhook from Voaray',
      timestamp: new Date().toISOString(),
      merchant_id
    };

    const signature = crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET || 'default-secret')
      .update(JSON.stringify(testPayload))
      .digest('hex');

    const result = await webhookService.sendOnce(url, testPayload, signature);

    res.json({
      success: result.success,
      message: result.success ? 'Webhook test successful' : 'Webhook test failed',
      details: result
    });
  } catch (error) {
    logger.error('Error testing webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * Récupère l'historique des webhooks envoyés pour un paiement
 */
export const getWebhookHistory = async (req: Request, res: Response) => {
  try {
    const { payment_id } = req.params;

    const webhooks = await prisma.webhookLog.findMany({
      where: {
        paymentId: payment_id,
        source: 'merchant'
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({
      success: true,
      data: webhooks
    });
  } catch (error) {
    logger.error('Error fetching webhook history:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};