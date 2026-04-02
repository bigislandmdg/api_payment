import { Router } from 'express';
import { reportController } from '../controllers/report.controllers';
import { verifyApiKey } from '../middleware/auth';

const router = Router();

// Toutes les routes nécessitent une clé API
router.use(verifyApiKey);

/**
 * @route   POST /api/reports/generate
 * @desc    Générer un rapport
 * @access  Private (API Key required)
 * @body    { period, format, includeDetails, sendEmail, email }
 */
router.post('/generate', reportController.generateReport);

/**
 * @route   GET /api/reports/download/:filename
 * @desc    Télécharger un rapport généré
 * @access  Private (API Key required)
 * @params  filename - Nom du fichier
 */
router.get('/download/:filename', reportController.downloadReport);

/**
 * @route   GET /api/reports/export/csv
 * @desc    Exporter les transactions en CSV
 * @access  Private (API Key required)
 * @query   startDate, endDate
 */
router.get('/export/csv', reportController.exportCSV);

/**
 * @route   GET /api/reports/transactions
 * @desc    Récupérer les transactions pour une période
 * @access  Private (API Key required)
 * @query   startDate, endDate, page, limit
 */
router.get('/transactions', reportController.getTransactions);

export default router;