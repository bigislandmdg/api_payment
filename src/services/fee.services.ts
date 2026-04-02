import prisma from "../config/database";
import logger from "../config/logger";

// Définir l'interface FeeResult
export interface FeeResult {
  partner: number;        // Pourcentage de commission du partenaire
  partnerAmount: number;  // Montant de la commission du partenaire
  voaray: number;         // Commission Voaray
  total: number;          // Commission totale
  net: number;            // Montant net après commission
  breakdown: {
    partnerPercentage: number;
    partnerFee: number;
    voarayFee: number;
    fixedFee: number;
  };
}

// Interface pour la configuration du marchand
export interface MerchantConfig {
  id: string;
  name: string;
  plan: 'BASIC' | 'PRO' | 'ENTERPRISE';
  customFeePercentage?: number;
  customFeeFixed?: number;
}

export class FeeService {
  
  /**
   * Calcule les frais pour une transaction
   * @param amount - Montant de la transaction
   * @param partner - Partenaire (MVOLA, ORANGE, AIRTEL)
   * @param merchantId - ID du marchand (optionnel)
   */
  async calculateFee(amount: number, partner: string, merchantId?: string): Promise<FeeResult> {
    let feePercentage = 1.5; // 1.5% par défaut
    let feeFixed = 500; // 500 Ar fixe
    
    // Commission partenaire (MVola, Orange, Airtel)
    switch (partner.toUpperCase()) {
      case 'MVOLA':
        feePercentage = 1.2;
        break;
      case 'ORANGE':
        feePercentage = 1.3;
        break;
      case 'AIRTEL':
        feePercentage = 1.4;
        break;
      default:
        feePercentage = 1.5;
    }
    
    // Commission marchand (si abonnement pro)
    if (merchantId) {
      try {
        const merchantConfig = await this.getMerchantConfig(merchantId);
        if (merchantConfig && merchantConfig.plan === 'PRO') {
          feePercentage = 1.0;
          feeFixed = 0;
        } else if (merchantConfig && merchantConfig.plan === 'ENTERPRISE') {
          feePercentage = 0.8;
          feeFixed = 0;
        }
      } catch (error) {
        logger.warn(`Failed to get merchant config for ${merchantId}:`, error);
      }
    }
    
    const percentageFee = amount * (feePercentage / 100);
    const totalFee = Math.max(percentageFee, feeFixed);
    const partnerAmount = amount * (feePercentage / 100);
    const voarayFee = totalFee - partnerAmount;
    
    return {
      partner: feePercentage,
      partnerAmount: partnerAmount,
      voaray: voarayFee,
      total: totalFee,
      net: amount - totalFee,
      breakdown: {
        partnerPercentage: feePercentage,
        partnerFee: partnerAmount,
        voarayFee: voarayFee,
        fixedFee: feeFixed > percentageFee ? feeFixed : 0
      }
    };
  }
  
  /**
   * Récupère la configuration d'un marchand
   * @param merchantId - ID du marchand
   */
  async getMerchantConfig(merchantId: string): Promise<MerchantConfig | null> {
    try {
      // Chercher le marchand dans la base de données
      const merchant = await (prisma as any).merchant.findUnique({
        where: { id: merchantId },
        include: { apiKeys: true }
      });
      
      if (!merchant) {
        return null;
      }
      
      // Extraire le plan depuis les settings ou utiliser BASIC par défaut
      const plan = merchant.settings?.plan || 'BASIC';
      
      return {
        id: merchant.id,
        name: merchant.name,
        plan: plan as 'BASIC' | 'PRO' | 'ENTERPRISE',
        customFeePercentage: merchant.settings?.customFeePercentage,
        customFeeFixed: merchant.settings?.customFeeFixed
      };
    } catch (error) {
      logger.error('Error getting merchant config:', error);
      return null;
    }
  }
  
  /**
   * Calcule les frais pour un partenaire spécifique
   * @param amount - Montant de la transaction
   * @param partnerName - Nom du partenaire
   */
  async calculatePartnerFee(amount: number, partnerName: string): Promise<{
    percentage: number;
    amount: number;
    fixed: number;
  }> {
    // Récupérer la configuration du partenaire depuis la base
    try {
      const partner = await (prisma as any).partnerConfig.findUnique({
        where: { name: partnerName.toUpperCase() }
      });
      
      if (partner) {
        const percentageFee = amount * (partner.feePercentage / 100);
        const totalFee = Math.max(percentageFee, partner.feeFixed);
        
        return {
          percentage: partner.feePercentage,
          amount: percentageFee,
          fixed: totalFee - percentageFee
        };
      }
    } catch (error) {
      logger.warn(`Partner ${partnerName} not found, using default fees`);
    }
    
    // Valeurs par défaut
    const defaultPercentage = 1.5;
    const defaultFixed = 500;
    const percentageFee = amount * (defaultPercentage / 100);
    const totalFee = Math.max(percentageFee, defaultFixed);
    
    return {
      percentage: defaultPercentage,
      amount: percentageFee,
      fixed: totalFee - percentageFee
    };
  }
  
  /**
   * Calcule la répartition des frais entre les parties
   * @param amount - Montant de la transaction
   * @param partner - Partenaire
   * @param merchantId - ID du marchand
   */
  async calculateFeeBreakdown(
    amount: number, 
    partner: string, 
    merchantId?: string
  ): Promise<{
    gross: number;
    partnerCommission: number;
    voarayCommission: number;
    merchantCommission: number;
    net: number;
  }> {
    const feeResult = await this.calculateFee(amount, partner, merchantId);
    
    return {
      gross: amount,
      partnerCommission: feeResult.partnerAmount,
      voarayCommission: feeResult.voaray,
      merchantCommission: 0, // À implémenter si les marchands peuvent avoir des commissions
      net: feeResult.net
    };
  }
  
  /**
   * Vérifie si un montant est valide selon les limites
   * @param amount - Montant à vérifier
   */
  validateAmount(amount: number): { valid: boolean; message?: string } {
    const minAmount = 100;
    const maxAmount = 10000000;
    
    if (amount < minAmount) {
      return {
        valid: false,
        message: `Amount must be at least ${minAmount} Ar`
      };
    }
    
    if (amount > maxAmount) {
      return {
        valid: false,
        message: `Amount cannot exceed ${maxAmount} Ar`
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Calcule le montant net après frais
   * @param amount - Montant brut
   * @param partner - Partenaire
   * @param merchantId - ID du marchand
   */
  async getNetAmount(amount: number, partner: string, merchantId?: string): Promise<number> {
    const feeResult = await this.calculateFee(amount, partner, merchantId);
    return feeResult.net;
  }
  
  /**
   * Calcule les frais totaux
   * @param amount - Montant brut
   * @param partner - Partenaire
   * @param merchantId - ID du marchand
   */
  async getTotalFees(amount: number, partner: string, merchantId?: string): Promise<number> {
    const feeResult = await this.calculateFee(amount, partner, merchantId);
    return feeResult.total;
  }
}

// Exporter une instance unique du service
export const feeService = new FeeService();