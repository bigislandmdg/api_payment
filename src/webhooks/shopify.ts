import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import prisma from '../config/database';

export const verifyShopifyWebhook = (req: Request, res: Response, next: NextFunction) => {
  // Désactiver la vérification en développement
  if (process.env.NODE_ENV === 'development') {
    console.log('⚠️ [DEV MODE] Shopify webhook signature verification disabled');
    return next();
  }

  const hmac = req.headers['x-shopify-hmac-sha256'] as string;
  const secret = process.env.SHOPIFY_API_SECRET;
  
  if (!hmac || !secret) {
    logger.warn('Missing Shopify webhook signature');
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid webhook signature' 
    });
  }

  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('base64');

  if (hash !== hmac) {
    logger.warn('Invalid Shopify webhook signature');
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid webhook signature' 
    });
  }

  next();
};

export const handleOrderCreate = async (req: Request, res: Response) => {
  try {
    const order = req.body;
    
    logger.info(`📦 New order created: ${order.id} - Total: ${order.total_price}`);
    
    await prisma.webhookLog.create({
      data: {
        paymentId: order.id?.toString(),
        event: 'SHOPIFY_ORDER_CREATED',
        source: 'shopify',
        payload: order,
        statusCode: 200,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });
    
    res.json({ success: true, message: 'Webhook processed successfully' });
  } catch (error) {
    logger.error('Error handling order create:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
};

export const handleOrderPaid = async (req: Request, res: Response) => {
  try {
    const order = req.body;
    
    logger.info(`💰 Order paid: ${order.id} - Financial status: ${order.financial_status}`);
    
    await prisma.webhookLog.create({
      data: {
        paymentId: order.id?.toString(),
        event: 'SHOPIFY_ORDER_PAID',
        source: 'shopify',
        payload: order,
        statusCode: 200,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });
    
    res.json({ success: true, message: 'Webhook processed successfully' });
  } catch (error) {
    logger.error('Error handling order paid:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
};

export const handleOrderCancelled = async (req: Request, res: Response) => {
  try {
    const order = req.body;
    
    logger.info(`❌ Order cancelled: ${order.id}`);
    
    await prisma.webhookLog.create({
      data: {
        paymentId: order.id?.toString(),
        event: 'SHOPIFY_ORDER_CANCELLED',
        source: 'shopify',
        payload: order,
        statusCode: 200,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });
    
    res.json({ success: true, message: 'Webhook processed successfully' });
  } catch (error) {
    logger.error('Error handling order cancelled:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
};

export const handleOrderRefund = async (req: Request, res: Response) => {
  try {
    const refund = req.body;
    
    logger.info(`🔄 Order refunded: ${refund.order_id} - Amount: ${refund.amount}`);
    
    await prisma.webhookLog.create({
      data: {
        paymentId: refund.order_id?.toString(),
        event: 'PAYMENT_REFUNDED',
        source: 'shopify',
        payload: refund,
        statusCode: 200,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });
    
    res.json({ success: true, message: 'Webhook processed successfully' });
  } catch (error) {
    logger.error('Error handling order refund:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
};
