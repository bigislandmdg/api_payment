import { Router } from 'express';
import { refundController } from '../controllers/refund.controllers';
import { verifyApiKey, verifySignature } from '../middleware/auth';

const router = Router();

/**
 * @route   POST /api/refunds
 * @desc    Créer un remboursement pour un paiement
 * @access  Private (API Key required)
 * @body    { payment_id, amount, reason, metadata }
 */
router.post('/', verifyApiKey, refundController.createRefund);

/**
 * @route   GET /api/refunds/:refund_id
 * @desc    Récupérer le statut d'un remboursement
 * @access  Private (API Key required)
 * @params  refund_id - ID du remboursement
 */
router.get('/:refund_id', verifyApiKey, refundController.getRefundStatus);

/**
 * @route   GET /api/refunds/payment/:payment_id
 * @desc    Récupérer tous les remboursements d'un paiement
 * @access  Private (API Key required)
 * @params  payment_id - ID du paiement
 * @query   page, limit
 */
router.get('/payment/:payment_id', verifyApiKey, refundController.getPaymentRefunds);

export default router;