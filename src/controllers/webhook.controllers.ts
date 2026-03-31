import { Request, Response } from 'express';
import prisma from '../config/database';
import { updateShopifyOrder } from '../services/shopify.services';
import { sendNotification } from '../services/notification.services';
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
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          errorMessage: `Transaction failed: ${status}`
        }
      });

      logger.warn(`Webhook processed: Payment ${payment.id} failed`);
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
    // Sinon, on log juste dans le fichier sans enregistrer en base
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
        data: req.body
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