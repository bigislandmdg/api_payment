import axios from 'axios';
import prisma from '../config/database';
import logger from '../config/logger';

export interface WebhookResult {
  success: boolean;
  attempt?: number;
  attempts?: number;
  error?: string;
  statusCode?: number;
}

export interface WebhookQueueItem {
  id: string;
  url: string;
  payload: any;
  signature: string;
  retries: number;
  maxRetries: number;
  scheduledAt: Date;
  lastAttemptAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class WebhookService {
  
  /**
   * Envoie un webhook avec système de retry automatique
   * @param url - URL du webhook
   * @param payload - Données à envoyer
   * @param signature - Signature HMAC pour la sécurité
   * @param retries - Nombre de tentatives maximal
   */
  async sendWithRetry(
    url: string, 
    payload: any, 
    signature: string,
    retries: number = 3
  ): Promise<WebhookResult> {
    let lastError: string = '';
    
    for (let i = 0; i < retries; i++) {
      try {
        const timestamp = Date.now().toString();
        
        const response = await axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': signature,
            'X-Timestamp': timestamp,
            'X-Retry-Count': i.toString(),
            'X-Webhook-Source': 'voaray'
          },
          timeout: 10000
        });
        
        if (response.status >= 200 && response.status < 300) {
          await this.logWebhookSuccess(url, payload, response.status, i);
          logger.info(`Webhook sent successfully to ${url} after ${i + 1} attempt(s)`);
          return { 
            success: true, 
            attempt: i + 1,
            statusCode: response.status
          };
        } else {
          lastError = `HTTP ${response.status}: ${response.statusText}`;
          await this.logWebhookFailure(url, payload, lastError, i, response.status);
        }
        
      } catch (error: any) {
        lastError = error.message || 'Unknown error';
        await this.logWebhookFailure(url, payload, lastError, i);
        
        if (error.code === 'ECONNREFUSED') {
          lastError = 'Connection refused - target server unreachable';
        } else if (error.code === 'ETIMEDOUT') {
          lastError = 'Connection timeout';
        }
      }
      
      // Si ce n'est pas le dernier essai, attendre avant de réessayer (backoff exponentiel)
      if (i < retries - 1) {
        const delay = Math.min(Math.pow(2, i) * 1000, 30000); // Max 30 secondes
        logger.warn(`Webhook to ${url} failed (attempt ${i + 1}/${retries}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Dernier essai échoué, mettre en file d'attente
    logger.error(`Webhook to ${url} failed after ${retries} attempts, queuing for later...`);
    await this.queueForLater(url, payload, signature, lastError);
    
    return { 
      success: false, 
      attempts: retries,
      error: lastError
    };
  }
  
  /**
   * Log un succès de webhook
   */
  private async logWebhookSuccess(
    url: string, 
    payload: any, 
    statusCode: number, 
    attempt: number
  ): Promise<void> {
    try {
      await (prisma as any).webhookLog.create({
        data: {
          event: 'WEBHOOK_SENT',
          source: 'voaray',
          payload: {
            url,
            payload: this.sanitizePayload(payload),
            attempt: attempt + 1,
            statusCode
          },
          response: { success: true, statusCode },
          statusCode: 200,
          processedAt: new Date()
        }
      });
    } catch (error) {
      logger.error('Failed to log webhook success:', error);
    }
  }
  
  /**
   * Log un échec de webhook
   */
  private async logWebhookFailure(
    url: string, 
    payload: any, 
    error: string, 
    attempt: number,
    statusCode?: number
  ): Promise<void> {
    try {
      await (prisma as any).webhookLog.create({
        data: {
          event: 'WEBHOOK_FAILED',
          source: 'voaray',
          payload: {
            url,
            payload: this.sanitizePayload(payload),
            attempt: attempt + 1,
            error,
            statusCode
          },
          response: { success: false, error, statusCode },
          statusCode: statusCode || 500,
          error,
          processedAt: new Date()
        }
      });
    } catch (error) {
      logger.error('Failed to log webhook failure:', error);
    }
  }
  
  /**
   * Met un webhook en file d'attente pour réessayer plus tard
   */
  private async queueForLater(
    url: string, 
    payload: any, 
    signature: string, 
    error?: string
  ): Promise<void> {
    try {
      const scheduledAt = new Date();
      scheduledAt.setMinutes(scheduledAt.getMinutes() + 15); // Réessayer dans 15 minutes
      
      await (prisma as any).webhookQueue.create({
        data: {
          url,
          payload: this.sanitizePayload(payload),
          signature,
          retries: 0,
          maxRetries: 10,
          scheduledAt,
          lastAttemptAt: new Date(),
          error
        }
      });
      
      logger.info(`Webhook queued for later: ${url}, scheduled at ${scheduledAt.toISOString()}`);
    } catch (error) {
      logger.error('Failed to queue webhook:', error);
    }
  }
  
  /**
   * Traite les webhooks en file d'attente
   */
  async processQueue(): Promise<number> {
    let processed = 0;
    
    try {
      const queuedWebhooks = await (prisma as any).webhookQueue.findMany({
        where: {
          scheduledAt: { lte: new Date() },
          retries: { lt: (prisma as any).webhookQueue.fields.maxRetries }
        },
        orderBy: { scheduledAt: 'asc' },
        take: 50
      });
      
      for (const webhook of queuedWebhooks) {
        processed++;
        
        try {
          const result = await this.sendWithRetry(
            webhook.url,
            webhook.payload,
            webhook.signature,
            1 // Une seule tentative pour la file d'attente
          );
          
          if (result.success) {
            // Supprimer de la file d'attente
            await (prisma as any).webhookQueue.delete({
              where: { id: webhook.id }
            });
            logger.info(`Queued webhook processed successfully: ${webhook.url}`);
          } else {
            // Mettre à jour le compteur de tentatives
            await (prisma as any).webhookQueue.update({
              where: { id: webhook.id },
              data: {
                retries: { increment: 1 },
                lastAttemptAt: new Date(),
                error: result.error,
                scheduledAt: new Date(Date.now() + this.getBackoffDelay(webhook.retries + 1))
              }
            });
            logger.warn(`Queued webhook failed, retry ${webhook.retries + 1}/10: ${webhook.url}`);
          }
        } catch (error) {
          logger.error(`Error processing queued webhook ${webhook.id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error processing webhook queue:', error);
    }
    
    return processed;
  }
  
  /**
   * Calcule le délai d'attente exponentiel
   */
  private getBackoffDelay(retryCount: number): number {
    const baseDelay = 15 * 60 * 1000; // 15 minutes
    const maxDelay = 24 * 60 * 60 * 1000; // 24 heures
    const delay = baseDelay * Math.pow(2, retryCount - 1);
    return Math.min(delay, maxDelay);
  }
  
  /**
   * Sanitize le payload pour le logging (supprime les données sensibles)
   */
  private sanitizePayload(payload: any): any {
    const sensitiveFields = ['password', 'secret', 'token', 'authorization', 'apiKey', 'apiSecret'];
    const sanitized = { ...payload };
    
    const sanitizeObject = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      
      const result = Array.isArray(obj) ? [...obj] : { ...obj };
      
      for (const key of Object.keys(result)) {
        if (sensitiveFields.includes(key.toLowerCase())) {
          result[key] = '***REDACTED***';
        } else if (typeof result[key] === 'object') {
          result[key] = sanitizeObject(result[key]);
        }
      }
      
      return result;
    };
    
    return sanitizeObject(sanitized);
  }
  
  /**
   * Envoie un webhook simple sans retry
   */
  async sendOnce(url: string, payload: any, signature: string): Promise<WebhookResult> {
    try {
      const timestamp = Date.now().toString();
      
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Timestamp': timestamp,
          'X-Webhook-Source': 'voaray'
        },
        timeout: 10000
      });
      
      await this.logWebhookSuccess(url, payload, response.status, 0);
      
      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        attempt: 1
      };
    } catch (error: any) {
      await this.logWebhookFailure(url, payload, error.message, 0);
      
      return {
        success: false,
        error: error.message,
        attempt: 1
      };
    }
  }
  
  /**
   * Vérifie la santé d'un endpoint webhook
   */
  async healthCheck(url: string): Promise<boolean> {
    try {
      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          'X-Health-Check': 'voaray'
        }
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }
}

export const webhookService = new WebhookService();