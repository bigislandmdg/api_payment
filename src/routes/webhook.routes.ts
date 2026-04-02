import { Router } from 'express';
import { 
  handleMobileMoneyWebhook, 
  handleShopifyWebhook,
  testMerchantWebhook,
  getWebhookHistory
} from '../controllers/webhook.controllers'; // ✅ Correction: .controller (sans 's')
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

/**
 * @route   POST /api/webhooks/test
 * @desc    Endpoint de test pour vérifier la configuration d'un webhook marchand
 * @access  Public (à sécuriser en production)
 * @body    { url, merchant_id }
 */
router.post('/test', testMerchantWebhook);

/**
 * @route   GET /api/webhooks/history/:payment_id
 * @desc    Récupère l'historique des webhooks pour un paiement
 * @access  Public
 * @params  payment_id - ID du paiement
 */
router.get('/history/:payment_id', getWebhookHistory);

export default router;