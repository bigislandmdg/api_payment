import { Router } from 'express';
import { merchantController } from '../controllers/merchant.controllers'; // ✅ Correction: .controller (sans 's')
import { verifyApiKey } from '../middleware/auth';

const router = Router();

/**
 * @route   POST /api/merchants/register
 * @desc    Créer un nouveau compte marchand
 * @access  Public
 * @body    { name, email, company, plan, phone, webhookUrl }
 */
router.post('/register', merchantController.createMerchant);

// ============================================
// ROUTES PROTÉGÉES PAR CLÉ API
// ============================================
router.use(verifyApiKey);

/**
 * @route   GET /api/merchants/info
 * @desc    Récupérer les informations du marchand
 * @access  Private (API Key required)
 */
router.get('/info', merchantController.getMerchantInfo);

/**
 * @route   GET /api/merchants/stats
 * @desc    Récupérer les statistiques du marchand
 * @access  Private (API Key required)
 * @query   period (day, week, month, year)
 */
router.get('/stats', merchantController.getMerchantStats);

/**
 * @route   PUT /api/merchants/update
 * @desc    Mettre à jour les informations du marchand
 * @access  Private (API Key required)
 * @body    { name, phone, companyName, taxId, webhookUrl, settings }
 */
router.put('/update', merchantController.updateMerchant);

/**
 * @route   GET /api/merchants/transactions
 * @desc    Récupérer la liste des transactions du marchand
 * @access  Private (API Key required)
 * @query   page, limit, status, startDate, endDate
 */
router.get('/transactions', merchantController.getMerchantTransactions);

/**
 * @route   POST /api/merchants/keys/:keyId/regenerate
 * @desc    Régénérer une clé API
 * @access  Private (API Key required)
 * @params  keyId - ID de la clé API à régénérer
 */
router.post('/keys/:keyId/regenerate', merchantController.regenerateApiKey);

export default router;