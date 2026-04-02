import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import logger from '../config/logger';
import { reportService } from '../services/report.services';

export class ReportController {
  
  /**
   * Générer un rapport
   */
  generateReport = async (req: Request, res: Response) => {
    try {
      const merchantId = req.merchantId;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      const { 
        startDate, 
        endDate, 
        format = 'both', 
        includeDetails = true,
        sendEmail = false,
        email 
      } = req.body;
      
      // Validation
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
          code: 'MISSING_DATES'
        });
      }
      
      const period = {
        start: new Date(startDate),
        end: new Date(endDate)
      };
      
      if (period.start > period.end) {
        return res.status(400).json({
          success: false,
          error: 'startDate must be before endDate',
          code: 'INVALID_DATES'
        });
      }
      
      const report = await reportService.generateReport({
        merchantId,
        period,
        format: format as 'pdf' | 'csv' | 'both',
        includeDetails,
        sendEmail,
        email
      });
      
      res.json({
        success: true,
        data: {
          summary: report.summary,
          by_method: report.byMethod,
          by_day: report.byDay,
          download_links: {
            pdf: report.pdfUrl ? `/api/reports/download${report.pdfUrl}` : null,
            csv: report.csvUrl ? `/api/reports/download${report.csvUrl}` : null
          }
        }
      });
      
    } catch (error) {
      logger.error('Error generating report:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
  
  /**
   * Télécharger un rapport
   */
  downloadReport = async (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      
      if (!filename) {
        return res.status(400).json({
          success: false,
          error: 'Filename is required',
          code: 'MISSING_FILENAME'
        });
      }
      
      const filepath = path.join(process.cwd(), 'reports', filename);
      
      if (!fs.existsSync(filepath)) {
        return res.status(404).json({
          success: false,
          error: 'File not found',
          code: 'NOT_FOUND'
        });
      }
      
      const ext = path.extname(filename).toLowerCase();
      let contentType = 'application/octet-stream';
      
      if (ext === '.pdf') {
        contentType = 'application/pdf';
      } else if (ext === '.csv') {
        contentType = 'text/csv';
      }
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      const stream = fs.createReadStream(filepath);
      stream.pipe(res);
      
    } catch (error) {
      logger.error('Error downloading report:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  };
  
  /**
   * Exporter les transactions en CSV
   */
  exportCSV = async (req: Request, res: Response) => {
    try {
      const merchantId = req.merchantId;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
          code: 'MISSING_DATES'
        });
      }
      
      const period = {
        start: new Date(startDate as string),
        end: new Date(endDate as string)
      };
      
      const where: any = {
        createdAt: { gte: period.start, lte: period.end },
        status: 'SUCCESS'
      };
      
      if (merchantId) {
        where.metadata = {
          path: ['merchant_id'],
          equals: merchantId
        };
      }
      
      const transactions = await prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'asc' }
      });
      
      const csvUrl = await reportService.exportToCSV(transactions, merchantId, period);
      
      res.json({
        success: true,
        data: {
          download_url: `/api/reports/download${csvUrl}`,
          transaction_count: transactions.length
        }
      });
      
    } catch (error) {
      logger.error('Error exporting CSV:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  };
  
  /**
   * Récupérer les transactions pour une période
   */
  getTransactions = async (req: Request, res: Response) => {
    try {
      const merchantId = req.merchantId;
      
      if (!merchantId) {
        return res.status(401).json({
          success: false,
          error: 'Merchant not identified',
          code: 'UNAUTHORIZED'
        });
      }
      
      const { startDate, endDate, page = 1, limit = 50 } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
          code: 'MISSING_DATES'
        });
      }
      
      const period = {
        start: new Date(startDate as string),
        end: new Date(endDate as string)
      };
      
      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip = (pageNum - 1) * limitNum;
      
      const where: any = {
        createdAt: { gte: period.start, lte: period.end },
        status: 'SUCCESS'
      };
      
      if (merchantId) {
        where.metadata = {
          path: ['merchant_id'],
          equals: merchantId
        };
      }
      
      const [transactions, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          skip,
          take: limitNum,
          include: {
            transactions: {
              take: 1,
              orderBy: { createdAt: 'desc' }
            }
          }
        }),
        prisma.payment.count({ where })
      ]);
      
      res.json({
        success: true,
        data: transactions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      });
      
    } catch (error) {
      logger.error('Error fetching transactions:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR'
      });
    }
  };
}

export const reportController = new ReportController();