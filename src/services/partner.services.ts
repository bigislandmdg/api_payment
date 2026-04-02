import prisma from "../config/database";
import logger from "../config/logger";
import { PartnerStatus } from '@prisma/client';

export interface PartnerConfig {
  id: string;
  name: 'MVOLA' | 'ORANGE' | 'AIRTEL';
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  merchantId: string;
  webhookSecret?: string;
  feePercentage: number;
  feeFixed: number;
  status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

export class PartnerService {
  private partners: Map<string, PartnerConfig> = new Map();
  private initialized = false;
  
  async initializePartners() {
    try {
      // Vérifier si la table partnerConfig existe
      const configs = await (prisma as any).partnerConfig.findMany();
      
      if (configs.length === 0) {
        logger.info('📝 No partners found in database, creating default partners...');
        await this.createDefaultPartners();
        return;
      }
      
      configs.forEach((config: any) => {
        this.partners.set(config.name, {
          id: config.id,
          name: config.name as 'MVOLA' | 'ORANGE' | 'AIRTEL',
          apiUrl: config.apiUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          merchantId: config.merchantId,
          webhookSecret: config.webhookSecret || undefined,
          feePercentage: config.feePercentage,
          feeFixed: config.feeFixed,
          status: config.status as 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE',
          createdAt: config.createdAt,
          updatedAt: config.updatedAt
        });
      });
      
      this.initialized = true;
      logger.info(`✅ Initialized ${this.partners.size} partners: ${Array.from(this.partners.keys()).join(', ')}`);
    } catch (error: any) {
      // Si la table n'existe pas, la créer
      if (error.code === 'P2021') {
        logger.warn('PartnerConfig table does not exist, creating default partners...');
        await this.createDefaultPartners();
      } else {
        logger.error('Failed to initialize partners:', error);
        throw error;
      }
    }
  }
  
  async createDefaultPartners() {
    try {
      const defaultPartners = [
        {
          name: 'MVOLA',
          apiUrl: process.env.MVOLA_API_URL || 'https://api.mvola.mg',
          clientId: process.env.MVOLA_CLIENT_ID || 'test_client_id',
          clientSecret: process.env.MVOLA_CLIENT_SECRET || 'test_client_secret',
          merchantId: process.env.MVOLA_MERCHANT_ID || 'test_merchant',
          webhookSecret: process.env.MVOLA_WEBHOOK_SECRET,
          feePercentage: 1.2,
          feeFixed: 500,
          status: PartnerStatus.ACTIVE
        },
        {
          name: 'ORANGE',
          apiUrl: process.env.ORANGE_API_URL || 'https://api.orange.mg',
          clientId: process.env.ORANGE_CLIENT_ID || 'test_client_id',
          clientSecret: process.env.ORANGE_CLIENT_SECRET || 'test_client_secret',
          merchantId: process.env.ORANGE_MERCHANT_ID || 'test_merchant',
          webhookSecret: process.env.ORANGE_WEBHOOK_SECRET,
          feePercentage: 1.3,
          feeFixed: 500,
          status: PartnerStatus.ACTIVE
        },
        {
          name: 'AIRTEL',
          apiUrl: process.env.AIRTEL_API_URL || 'https://api.airtel.mg',
          clientId: process.env.AIRTEL_CLIENT_ID || 'test_client_id',
          clientSecret: process.env.AIRTEL_CLIENT_SECRET || 'test_client_secret',
          merchantId: process.env.AIRTEL_MERCHANT_ID || 'test_merchant',
          webhookSecret: process.env.AIRTEL_WEBHOOK_SECRET,
          feePercentage: 1.4,
          feeFixed: 500,
          status: PartnerStatus.ACTIVE
        }
      ];

      for (const partner of defaultPartners) {
        try {
          await (prisma as any).partnerConfig.create({
            data: {
              name: partner.name,
              apiUrl: partner.apiUrl,
              clientId: partner.clientId,
              clientSecret: partner.clientSecret,
              merchantId: partner.merchantId,
              webhookSecret: partner.webhookSecret,
              feePercentage: partner.feePercentage,
              feeFixed: partner.feeFixed,
              status: partner.status
            }
          });
          logger.info(`✅ Created default partner: ${partner.name}`);
        } catch (error: any) {
          if (error.code === 'P2002') {
            logger.info(`Partner ${partner.name} already exists`);
          } else {
            logger.warn(`Failed to create partner ${partner.name}:`, error.message);
          }
        }
      }
      
      // Recharger les partenaires après création
      await this.initializePartners();
    } catch (error) {
      logger.error('Failed to create default partners:', error);
      throw error;
    }
  }
  
  async getPartner(name: string): Promise<PartnerConfig> {
    if (!this.initialized) {
      await this.initializePartners();
    }
    
    const partner = this.partners.get(name);
    if (!partner) {
      throw new Error(`Partner ${name} not configured`);
    }
    if (partner.status !== 'ACTIVE') {
      throw new Error(`Partner ${name} is in ${partner.status} mode`);
    }
    return partner;
  }
  
  async updatePartnerStatus(name: string, status: string): Promise<void> {
    await (prisma as any).partnerConfig.update({
      where: { name },
      data: { status }
    });
    await this.initializePartners();
  }
  
  async createPartner(data: Omit<PartnerConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<PartnerConfig> {
    const partner = await (prisma as any).partnerConfig.create({
      data: {
        name: data.name,
        apiUrl: data.apiUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        merchantId: data.merchantId,
        webhookSecret: data.webhookSecret,
        feePercentage: data.feePercentage,
        feeFixed: data.feeFixed,
        status: data.status
      }
    });
    
    await this.initializePartners();
    
    return {
      id: partner.id,
      name: partner.name as 'MVOLA' | 'ORANGE' | 'AIRTEL',
      apiUrl: partner.apiUrl,
      clientId: partner.clientId,
      clientSecret: partner.clientSecret,
      merchantId: partner.merchantId,
      webhookSecret: partner.webhookSecret || undefined,
      feePercentage: partner.feePercentage,
      feeFixed: partner.feeFixed,
      status: partner.status as 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE',
      createdAt: partner.createdAt,
      updatedAt: partner.updatedAt
    };
  }
  
  async getAllPartners(): Promise<PartnerConfig[]> {
    if (!this.initialized) {
      await this.initializePartners();
    }
    return Array.from(this.partners.values());
  }
  
  async getPartnerStatuses(): Promise<Record<string, string>> {
    const partners = await this.getAllPartners();
    const statuses: Record<string, string> = {};
    partners.forEach(partner => {
      statuses[partner.name] = partner.status;
    });
    return statuses;
  }
  
  // Méthode pour vérifier si un partenaire est actif
  async isPartnerActive(name: string): Promise<boolean> {
    try {
      const partner = await this.getPartner(name);
      return partner.status === 'ACTIVE';
    } catch {
      return false;
    }
  }
}

export const partnerService = new PartnerService();