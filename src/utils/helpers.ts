import crypto from 'crypto';

/**
 * Génère une signature HMAC SHA256
 */
export const generateSignature = (payload: any, secret: string): string => {
  const timestamp = Date.now().toString();
  const data = timestamp + JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
  
  return signature;
};

/**
 * Vérifie une signature HMAC
 */
export const verifySignature = (payload: any, signature: string, timestamp: string, secret: string): boolean => {
  const data = timestamp + JSON.stringify(payload);
  const hash = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
  
  return hash === signature;
};

/**
 * Formate un numéro de téléphone malgache
 */
export const formatPhoneNumber = (phone: string): string => {
  let cleaned = phone.replace(/\s/g, '');
  
  if (!cleaned.startsWith('0') && cleaned.length === 9) {
    cleaned = '0' + cleaned;
  }
  
  return cleaned;
};

/**
 * Valide un numéro de téléphone malgache (10 chiffres)
 */
export const validatePhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^[0-9]{10}$/;
  return phoneRegex.test(phone.replace(/\s/g, ''));
};

/**
 * Calcule les frais de transaction
 */
export const calculateFee = (amount: number): number => {
  const percentage = parseFloat(process.env.PAYMENT_FEE_PERCENTAGE || '1.5') / 100;
  const fixedFee = parseFloat(process.env.PAYMENT_FEE_FIXED || '500');
  const fee = amount * percentage;
  return Math.max(fee, fixedFee);
};

/**
 * Formate un montant en Ariary
 */
export const formatAmount = (amount: number): string => {
  return new Intl.NumberFormat('mg-MG', {
    style: 'currency',
    currency: 'MGA',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

/**
 * Génère une référence unique
 */
export const generateReference = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `VOY-${timestamp}-${random}`.toUpperCase();
};

/**
 * Masque un numéro de téléphone
 */
export const maskPhoneNumber = (phone: string): string => {
  if (phone.length !== 10) return phone;
  return phone.substring(0, 4) + '****' + phone.substring(8);
};

/**
 * Retarde l'exécution (sleep)
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Réessaie une fonction asynchrone en cas d'échec
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
};

/**
 * Extrait le nom du provider à partir de l'URL
 */
export const extractProviderFromUrl = (url: string): string => {
  if (url.includes('mvola')) return 'MVOLA';
  if (url.includes('orange')) return 'ORANGE';
  if (url.includes('airtel')) return 'AIRTEL';
  return 'UNKNOWN';
};

/**
 * Vérifie si une commande est valide
 */
export const isValidOrderId = (orderId: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const numericRegex = /^[0-9]+$/;
  
  return uuidRegex.test(orderId) || numericRegex.test(orderId);
};

/**
 * Calcule le montant net après frais
 */
export const calculateNetAmount = (amount: number): number => {
  const fee = calculateFee(amount);
  return amount - fee;
};

/**
 * Vérifie si le paiement a expiré
 */
export const isPaymentExpired = (createdAt: Date, timeoutSeconds: number = 300): boolean => {
  const now = new Date();
  const created = new Date(createdAt);
  const diffSeconds = (now.getTime() - created.getTime()) / 1000;
  return diffSeconds > timeoutSeconds;
};

/**
 * Convertit un objet en JSON sécurisé (sans données sensibles)
 */
export const toSafeJSON = (obj: any): any => {
  const sensitiveFields = ['password', 'secret', 'token', 'key', 'authorization'];
  const safe = { ...obj };
  
  for (const field of sensitiveFields) {
    if (safe[field]) {
      safe[field] = '***REDACTED***';
    }
  }
  
  return safe;
};

/**
 * Génère un ID unique court
 */
export const generateShortId = (): string => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};