import { Router } from 'express';
import { 
  createPayment, 
  getPaymentStatus, 
  confirmPayment 
} from '../controllers/payment.controllers';
import { verifySignature } from '../middleware/auth';
import { validatePaymentRequest, validateConfirmPayment } from '../middleware/validation';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting spécifique pour les créations de paiement
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // 10 requêtes par IP
  message: {
    success: false,
    error: 'Too many payment requests from this IP',
    code: 'RATE_LIMITED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting pour les confirmations
const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: 'Too many confirmation attempts',
    code: 'RATE_LIMITED'
  }
});

/**
 * @route   POST /api/payments
 * @desc    Créer un nouveau paiement
 * @access  Public (avec signature HMAC)
 * @body    { amount, order_id, phone, method, return_url }
 */
router.post('/', 
  paymentLimiter,
  verifySignature, 
  validatePaymentRequest, 
  createPayment
);

/**
 * @route   GET /api/payments/:id
 * @desc    Récupérer le statut d'un paiement
 * @access  Public
 * @params  id - ID du paiement
 */
router.get('/:id', getPaymentStatus);

/**
 * @route   POST /api/payments/confirm
 * @desc    Confirmer un paiement (avec code de confirmation)
 * @access  Public (avec signature HMAC)
 * @body    { payment_id, confirmation_code, otp }
 */
router.post('/confirm', 
  confirmLimiter,
  verifySignature, 
  validateConfirmPayment, 
  confirmPayment
);

export default router;