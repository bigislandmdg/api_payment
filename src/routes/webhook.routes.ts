import { Router } from 'express';
import { 
  handleMobileMoneyWebhook, 
  handleShopifyWebhook 
} from '../controllers/webhook.controllers';
import { verifyShopifyWebhook } from '../webhooks/shopify';

const router = Router();

/**
 * @route   POST /api/webhooks/mobile-money
 * @desc    Webhook pour les callbacks des opérateurs Mobile Money
 * @access  Public (vérifié par IP ou signature)
 * @body    { transaction_id, status, payment_id, amount, phone }
 */
router.post('/mobile-money', handleMobileMoneyWebhook);

/**
 * @route   POST /api/webhooks/shopify
 * @desc    Webhook pour les événements Shopify
 * @access  Public (vérifié par signature HMAC Shopify)
 * @body    Données du webhook Shopify
 */
router.post('/shopify', verifyShopifyWebhook, handleShopifyWebhook);

export default router;