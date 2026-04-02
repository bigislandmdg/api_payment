import prisma from "../config/database";
import logger from "../config/logger";
import { createObjectCsvStringifier } from 'csv-writer';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

// ============================================
// INTERFACES
// ============================================

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ReportSummary {
  totalTransactions: number;
  totalVolume: number;
  totalFees: number;
  netVolume: number;
  averageTransaction: number;
  averageFee: number;
  successRate: number;
}

export interface Report {
  summary: ReportSummary;
  byMethod: Array<{
    method: string;
    count: number;
    volume: number;
    fees: number;
    netVolume: number;
  }>;
  byDay: Array<{
    date: string;
    count: number;
    volume: number;
    fees: number;
  }>;
  pdfUrl?: string;
  csvUrl?: string;
}

export interface ReportOptions {
  merchantId: string;
  period: DateRange;
  format: 'pdf' | 'csv' | 'both';
  includeDetails: boolean;
  sendEmail?: boolean;
  email?: string;
}

// ============================================
// REPORT SERVICE
// ============================================

export class ReportService {
  
  /**
   * Génère un rapport complet pour un marchand
   * @param options - Options du rapport
   */
  async generateReport(options: ReportOptions): Promise<Report> {
    try {
      const { merchantId, period, format, includeDetails, sendEmail, email } = options;
      
      logger.info(`Generating report for merchant ${merchantId} from ${period.start} to ${period.end}`);
      
      // Récupérer les transactions
      const where: any = {
        createdAt: { gte: period.start, lte: period.end },
        status: 'SUCCESS'
      };
      
      // Ajouter le filtre merchantId si fourni
      if (merchantId) {
        where.metadata = {
          path: ['merchant_id'],
          equals: merchantId
        };
      }
      
      const transactions = await prisma.payment.findMany({
        where,
        include: {
          transactions: true
        },
        orderBy: { createdAt: 'asc' }
      });
      
      // Calculer les statistiques
      const summary = this.calculateSummary(transactions);
      const byMethod = this.groupByMethod(transactions);
      const byDay = this.groupByDay(transactions);
      
      let pdfUrl: string | undefined;
      let csvUrl: string | undefined;
      
      // Générer les fichiers
      if (format === 'pdf' || format === 'both') {
        pdfUrl = await this.generatePDF(summary, byMethod, byDay, transactions, period, includeDetails);
      }
      
      if (format === 'csv' || format === 'both') {
        csvUrl = await this.exportToCSV(transactions, merchantId, period);
      }
      
      // Envoyer par email si demandé
      if (sendEmail && email) {
        await this.sendReportByEmail(email, summary, pdfUrl, csvUrl, period);
      }
      
      return {
        summary,
        byMethod,
        byDay,
        pdfUrl,
        csvUrl
      };
      
    } catch (error) {
      logger.error('Error generating report:', error);
      throw new Error(`Failed to generate report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Calcule le résumé des statistiques
   * @param transactions - Liste des transactions
   */
  private calculateSummary(transactions: any[]): ReportSummary {
    const totalTransactions = transactions.length;
    const totalVolume = transactions.reduce((sum, t) => sum + t.amount, 0);
    const totalFees = transactions.reduce((sum, t) => sum + (t.fee || 0), 0);
    const netVolume = totalVolume - totalFees;
    
    return {
      totalTransactions,
      totalVolume,
      totalFees,
      netVolume,
      averageTransaction: totalTransactions > 0 ? totalVolume / totalTransactions : 0,
      averageFee: totalTransactions > 0 ? totalFees / totalTransactions : 0,
      successRate: 100 // Pour les rapports, on ne prend que les succès
    };
  }
  
  /**
   * Groupe les transactions par méthode de paiement
   * @param transactions - Liste des transactions
   */
  private groupByMethod(transactions: any[]): Array<{
    method: string;
    count: number;
    volume: number;
    fees: number;
    netVolume: number;
  }> {
    const groups = new Map<string, { count: number; volume: number; fees: number }>();
    
    for (const transaction of transactions) {
      const method = transaction.method;
      const existing = groups.get(method) || { count: 0, volume: 0, fees: 0 };
      
      existing.count++;
      existing.volume += transaction.amount;
      existing.fees += transaction.fee || 0;
      
      groups.set(method, existing);
    }
    
    return Array.from(groups.entries()).map(([method, data]) => ({
      method,
      count: data.count,
      volume: data.volume,
      fees: data.fees,
      netVolume: data.volume - data.fees
    }));
  }
  
  /**
   * Groupe les transactions par jour
   * @param transactions - Liste des transactions
   */
  private groupByDay(transactions: any[]): Array<{
    date: string;
    count: number;
    volume: number;
    fees: number;
  }> {
    const groups = new Map<string, { count: number; volume: number; fees: number }>();
    
    for (const transaction of transactions) {
      const date = transaction.createdAt.toISOString().split('T')[0];
      const existing = groups.get(date) || { count: 0, volume: 0, fees: 0 };
      
      existing.count++;
      existing.volume += transaction.amount;
      existing.fees += transaction.fee || 0;
      
      groups.set(date, existing);
    }
    
    return Array.from(groups.entries())
      .map(([date, data]) => ({
        date,
        count: data.count,
        volume: data.volume,
        fees: data.fees
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  
  /**
   * Génère un fichier PDF
   * @param summary - Résumé des statistiques
   * @param byMethod - Données par méthode
   * @param byDay - Données par jour
   * @param transactions - Liste des transactions
   * @param period - Période
   * @param includeDetails - Inclure les détails
   */
  private async generatePDF(
    summary: ReportSummary,
    byMethod: any[],
    byDay: any[],
    transactions: any[],
    period: DateRange,
    includeDetails: boolean
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const reportsDir = path.join(process.cwd(), 'reports');
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        
        const filename = `report_${Date.now()}.pdf`;
        const filepath = path.join(reportsDir, filename);
        
        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(filepath);
        
        doc.pipe(stream);
        
        // En-tête
        doc.fontSize(20).text('Voaray Payment Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Period: ${period.start.toISOString().split('T')[0]} to ${period.end.toISOString().split('T')[0]}`, { align: 'center' });
        doc.moveDown();
        
        // Résumé
        doc.fontSize(16).text('Summary', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10);
        doc.text(`Total Transactions: ${summary.totalTransactions}`);
        doc.text(`Total Volume: ${summary.totalVolume.toLocaleString()} Ar`);
        doc.text(`Total Fees: ${summary.totalFees.toLocaleString()} Ar`);
        doc.text(`Net Volume: ${summary.netVolume.toLocaleString()} Ar`);
        doc.text(`Average Transaction: ${summary.averageTransaction.toLocaleString()} Ar`);
        doc.text(`Average Fee: ${summary.averageFee.toLocaleString()} Ar`);
        doc.moveDown();
        
        // Par méthode de paiement
        doc.fontSize(14).text('By Payment Method', { underline: true });
        doc.moveDown(0.5);
        
        const methodTableTop = doc.y;
        let methodY = methodTableTop;
        
        doc.fontSize(10);
        doc.text('Method', 50, methodY);
        doc.text('Count', 150, methodY);
        doc.text('Volume (Ar)', 250, methodY);
        doc.text('Fees (Ar)', 350, methodY);
        doc.text('Net (Ar)', 450, methodY);
        
        methodY += 20;
        
        for (const method of byMethod) {
          doc.text(method.method, 50, methodY);
          doc.text(method.count.toString(), 150, methodY);
          doc.text(method.volume.toLocaleString(), 250, methodY);
          doc.text(method.fees.toLocaleString(), 350, methodY);
          doc.text(method.netVolume.toLocaleString(), 450, methodY);
          methodY += 20;
          
          if (methodY > 700) {
            doc.addPage();
            methodY = 50;
          }
        }
        
        doc.moveDown();
        
        // Transactions par jour
        doc.fontSize(14).text('Daily Transactions', { underline: true });
        doc.moveDown(0.5);
        
        let dayY = doc.y;
        
        doc.fontSize(10);
        doc.text('Date', 50, dayY);
        doc.text('Count', 150, dayY);
        doc.text('Volume (Ar)', 250, dayY);
        doc.text('Fees (Ar)', 350, dayY);
        
        dayY += 20;
        
        for (const day of byDay) {
          doc.text(day.date, 50, dayY);
          doc.text(day.count.toString(), 150, dayY);
          doc.text(day.volume.toLocaleString(), 250, dayY);
          doc.text(day.fees.toLocaleString(), 350, dayY);
          dayY += 20;
          
          if (dayY > 700) {
            doc.addPage();
            dayY = 50;
          }
        }
        
        // Détails des transactions
        if (includeDetails && transactions.length > 0) {
          doc.addPage();
          doc.fontSize(14).text('Transaction Details', { underline: true });
          doc.moveDown(0.5);
          
          let detailY = doc.y;
          
          doc.fontSize(8);
          doc.text('ID', 30, detailY);
          doc.text('Order ID', 100, detailY);
          doc.text('Amount', 200, detailY);
          doc.text('Method', 280, detailY);
          doc.text('Status', 350, detailY);
          doc.text('Date', 420, detailY);
          
          detailY += 15;
          
          for (const transaction of transactions.slice(0, 100)) { // Limite à 100 transactions
            doc.text(transaction.id.substring(0, 8), 30, detailY);
            doc.text(transaction.orderId.substring(0, 15), 100, detailY);
            doc.text(transaction.amount.toLocaleString(), 200, detailY);
            doc.text(transaction.method, 280, detailY);
            doc.text(transaction.status, 350, detailY);
            doc.text(transaction.createdAt.toISOString().split('T')[0], 420, detailY);
            detailY += 15;
            
            if (detailY > 750) {
              doc.addPage();
              detailY = 50;
            }
          }
        }
        
        doc.end();
        
        stream.on('finish', () => {
          resolve(`/reports/${filename}`);
        });
        
        stream.on('error', reject);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Exporte les transactions en CSV
   * @param transactions - Liste des transactions
   * @param merchantId - ID du marchand
   * @param period - Période
   */
  async exportToCSV(transactions: any[], merchantId: string, period: DateRange): Promise<string> {
    try {
      const reportsDir = path.join(process.cwd(), 'reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }
      
      const filename = `export_${merchantId}_${Date.now()}.csv`;
      const filepath = path.join(reportsDir, filename);
      
      const csvStringifier = createObjectCsvStringifier({
        header: [
          { id: 'id', title: 'Transaction ID' },
          { id: 'orderId', title: 'Order ID' },
          { id: 'amount', title: 'Amount (Ar)' },
          { id: 'method', title: 'Payment Method' },
          { id: 'status', title: 'Status' },
          { id: 'fee', title: 'Fee (Ar)' },
          { id: 'netAmount', title: 'Net Amount (Ar)' },
          { id: 'phone', title: 'Phone Number' },
          { id: 'createdAt', title: 'Created At' },
          { id: 'completedAt', title: 'Completed At' }
        ]
      });
      
      const records = transactions.map(t => ({
        id: t.id,
        orderId: t.orderId,
        amount: t.amount,
        method: t.method,
        status: t.status,
        fee: t.fee || 0,
        netAmount: t.netAmount || t.amount,
        phone: t.phone,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() || ''
      }));
      
      const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);
      
      fs.writeFileSync(filepath, csvContent);
      
      logger.info(`CSV exported: ${filepath}`);
      
      return `/reports/${filename}`;
      
    } catch (error) {
      logger.error('Error exporting to CSV:', error);
      throw new Error(`Failed to export CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Envoie un rapport par email
   * @param email - Adresse email
   * @param summary - Résumé des statistiques
   * @param pdfUrl - URL du PDF
   * @param csvUrl - URL du CSV
   * @param period - Période
   */
  private async sendReportByEmail(
    email: string,
    summary: ReportSummary,
    pdfUrl?: string,
    csvUrl?: string,
    period?: DateRange
  ): Promise<void> {
    try {
      // Configurer le transporteur email
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      
      const subject = `Voaray Payment Report - ${period?.start.toISOString().split('T')[0]} to ${period?.end.toISOString().split('T')[0]}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .summary { background: #f5f5f5; padding: 20px; border-radius: 10px; }
            .summary h2 { color: #667eea; }
            .stats { display: flex; gap: 20px; margin-top: 20px; }
            .stat-card { background: white; padding: 15px; border-radius: 8px; flex: 1; text-align: center; }
            .stat-value { font-size: 24px; font-weight: bold; color: #667eea; }
          </style>
        </head>
        <body>
          <h1>Voaray Payment Report</h1>
          
          <div class="summary">
            <h2>Summary</h2>
            <div class="stats">
              <div class="stat-card">
                <div class="stat-value">${summary.totalTransactions}</div>
                <div>Transactions</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${summary.totalVolume.toLocaleString()} Ar</div>
                <div>Total Volume</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${summary.totalFees.toLocaleString()} Ar</div>
                <div>Total Fees</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${summary.netVolume.toLocaleString()} Ar</div>
                <div>Net Volume</div>
              </div>
            </div>
          </div>
          
          <p style="margin-top: 20px;">Please find attached the detailed report.</p>
          
          <hr />
          <p style="color: #666; font-size: 12px;">Generated by Voaray Payment Gateway</p>
        </body>
        </html>
      `;
      
      const mailOptions: any = {
        from: process.env.SMTP_FROM || 'reports@voaray.com',
        to: email,
        subject,
        html
      };
      
      // Attacher les fichiers
      const attachments = [];
      
      if (pdfUrl) {
        const pdfPath = path.join(process.cwd(), pdfUrl);
        if (fs.existsSync(pdfPath)) {
          attachments.push({
            filename: `report_${Date.now()}.pdf`,
            path: pdfPath
          });
        }
      }
      
      if (csvUrl) {
        const csvPath = path.join(process.cwd(), csvUrl);
        if (fs.existsSync(csvPath)) {
          attachments.push({
            filename: `export_${Date.now()}.csv`,
            path: csvPath
          });
        }
      }
      
      if (attachments.length > 0) {
        mailOptions.attachments = attachments;
      }
      
      await transporter.sendMail(mailOptions);
      
      logger.info(`Report email sent to ${email}`);
      
    } catch (error) {
      logger.error('Error sending report email:', error);
      // Ne pas lancer d'erreur, juste logger
    }
  }
  
  /**
   * Nettoie les anciens rapports
   * @param daysToKeep - Nombre de jours à conserver
   */
  async cleanOldReports(daysToKeep: number = 30): Promise<void> {
    try {
      const reportsDir = path.join(process.cwd(), 'reports');
      if (!fs.existsSync(reportsDir)) return;
      
      const files = fs.readdirSync(reportsDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        const filePath = path.join(reportsDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          logger.info(`Deleted old report: ${file}`);
        }
      }
      
    } catch (error) {
      logger.error('Error cleaning old reports:', error);
    }
  }
}

export const reportService = new ReportService();