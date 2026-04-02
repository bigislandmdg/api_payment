// ============================================
// PAYMENT TYPES
// ============================================

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  phone: string;
  method: 'MVOLA' | 'ORANGE' | 'AIRTEL';
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED';
  transactionId?: string;
  reference?: string;
  providerRef?: string;
  metadata?: PaymentMetadata;
  errorMessage?: string;
  retryCount: number;
  fee?: number;
  netAmount?: number;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface PaymentMetadata {
  return_url?: string;
  ip_address?: string;
  user_agent?: string;
  email?: string;
  customer_name?: string;
  [key: string]: any;
}

export interface PaymentRequest {
  amount: number;
  order_id: string;
  phone: string;
  method: string;
  return_url?: string;
  email?: string;
  customer_name?: string;
}

export interface PaymentResponse {
  success: boolean;
  payment_id?: string;
  payment_url?: string;
  reference?: string;
  qr_code?: string;
  expires_in?: number;
  fees?: {
    total: number;
    net: number;
    breakdown: {
      partnerPercentage: number;
      partnerFee: number;
      voarayFee: number;
      fixedFee: number;
    };
  };
  error?: string;
  code?: string;
}

export interface PaymentConfirmRequest {
  payment_id: string;
  confirmation_code?: string;
  otp?: string;
}

export interface PaymentStatusResponse {
  success: boolean;
  payment_id: string;
  order_id: string;
  amount: number;
  status: string;
  method: string;
  phone: string;
  transaction_id?: string;
  reference?: string;
  created_at: Date;
  completed_at?: Date;
  error_message?: string;
}

// ============================================
// WEBHOOK TYPES
// ============================================

export interface WebhookPayload {
  payment_id: string;
  transaction_id: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  amount: number;
  phone: string;
  provider: string;
  timestamp: string;
  reference?: string;
  error_code?: string;
  error_message?: string;
  metadata?: Record<string, any>;
}

export interface ShopifyWebhookPayload {
  id: number;
  order_number: number;
  total_price: string;
  total_price_usd: string;
  currency: string;
  customer: ShopifyCustomer;
  line_items: ShopifyLineItem[];
  financial_status: string;
  fulfillment_status: string;
  created_at: string;
  updated_at: string;
}

export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  sku: string;
}

// ============================================
// MOBILE MONEY PROVIDER TYPES
// ============================================

export interface PaymentResult {
  success: boolean;
  transaction_id?: string;
  reference?: string;
  error?: string;
  provider_response?: any;
  requires_confirmation?: boolean;
}

export interface TransactionStatus {
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  transaction_id: string;
  amount: number;
  provider?: string;
  details?: any;
}

export interface RefundResult {
  success: boolean;
  refund_id?: string;
  transaction_id?: string;
  error?: string;
  amount?: number;
}

export interface MobileMoneyProvider {
  name: string;
  processPayment(payment: Payment, confirmationCode?: string): Promise<PaymentResult>;
  checkStatus(transactionId: string): Promise<TransactionStatus>;
  refund(transactionId: string, amount: number): Promise<RefundResult>;
}

// ============================================
// MVOLA API TYPES
// ============================================

export interface MvolaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface MvolaPaymentRequest {
  amount: number;
  currency: string;
  debtorParty: string;
  creditorParty: string;
  reference: string;
  description: string;
  callbackUrl?: string;
}

export interface MvolaPaymentResponse {
  status: string;
  transactionId: string;
  message?: string;
  reference?: string;
}

// ============================================
// ORANGE MONEY API TYPES
// ============================================

export interface OrangeTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface OrangePaymentRequest {
  amount: number;
  phone_number: string;
  reference: string;
  description: string;
  merchant_id?: string;
}

export interface OrangePaymentResponse {
  status: string;
  transaction_id: string;
  message?: string;
  pay_token?: string;
}

// ============================================
// AIRTEL MONEY API TYPES
// ============================================

export interface AirtelTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AirtelPaymentRequest {
  amount: number;
  currency: string;
  subscriber: string;
  reference: string;
  transaction_type: string;
  description?: string;
}

export interface AirtelPaymentResponse {
  status: string;
  transaction_id: string;
  message?: string;
  reference?: string;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  timestamp: string;
  path?: string;
}

export interface PaginatedResponse<T = any> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  timestamp: string;
  path?: string;
  errors?: ValidationError[];
}

export interface ValidationError {
  type: string;
  value?: any;
  msg: string;
  path: string;
  location: string;
}

// ============================================
// AUTH TYPES
// ============================================

export interface AuthRequest {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  merchantId?: string;
  apiKey?: string;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  secret: string;
  merchantId: string;
  merchantName: string;
  email?: string;
  active: boolean;
  permissions: string[];
  rateLimit: number;
  lastUsedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// NOTIFICATION TYPES
// ============================================

export interface NotificationData {
  email?: string;
  phone?: string;
  message: string;
  type: 'payment_success' | 'payment_failed' | 'payment_pending';
  metadata?: {
    amount?: number;
    orderId?: string;
    transactionId?: string;
    [key: string]: any;
  };
}

export interface EmailData {
  to: string;
  subject: string;
  template: string;
  data: Record<string, any>;
}

export interface SMSData {
  to: string;
  message: string;
}

// ============================================
// SHOPIFY TYPES
// ============================================

export interface ShopifyOrder {
  id: number;
  order_number: number;
  total_price: string;
  total_price_usd: string;
  currency: string;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
  };
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
    sku: string;
    variant_id: number;
  }>;
  financial_status: string;
  fulfillment_status: string;
  created_at: string;
  updated_at: string;
  shipping_address?: {
    first_name: string;
    last_name: string;
    address1: string;
    city: string;
    province: string;
    country: string;
    zip: string;
    phone: string;
  };
}

export interface ShopifyTransaction {
  id: number;
  order_id: number;
  amount: string;
  kind: string;
  status: string;
  gateway: string;
  message?: string;
  created_at: string;
}

// ============================================
// DATABASE MODELS (compatibles avec Prisma)
// ============================================

export interface DatabasePayment {
  id: string;
  orderId: string;
  amount: number;
  phone: string;
  method: string;
  status: string;
  transactionId?: string;
  reference?: string;
  providerRef?: string;
  metadata?: any;
  errorMessage?: string;
  retryCount: number;
  fee?: number;
  netAmount?: number;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface DatabaseTransaction {
  id: string;
  paymentId: string;
  type: string;
  provider: string;
  providerRef: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  status: string;
  metadata?: any;
  requestData?: any;
  responseData?: any;
  createdAt: Date;
}

export interface DatabaseWebhookLog {
  id: string;
  paymentId?: string;
  event: string;
  source: string;
  payload: any;
  response?: any;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  error?: string;
  processedAt: Date;
  createdAt: Date;
}

// ============================================
// UTILITY TYPES
// ============================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface FilterParams extends PaginationParams {
  status?: string;
  method?: string;
  phone?: string;
  orderId?: string;
  dateRange?: DateRange;
}

export interface StatsResponse {
  total_payments: number;
  successful_payments: number;
  failed_payments: number;
  pending_payments: number;
  total_amount: number;
  total_fees: number;
  success_rate: string;
  average_transaction: number;
}

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface AppConfig {
  port: number;
  env: string;
  baseUrl: string;
  databaseUrl: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  secretKey: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigin: string[];
  logLevel: string;
}

export interface MobileMoneyConfig {
  mvola: {
    apiUrl: string;
    clientId: string;
    clientSecret: string;
    merchantId: string;
    callbackUrl: string;
  };
  orange: {
    apiUrl: string;
    clientId: string;
    clientSecret: string;
    merchantId: string;
    callbackUrl: string;
  };
  airtel: {
    apiUrl: string;
    clientId: string;
    clientSecret: string;
    merchantId: string;
    callbackUrl: string;
  };
}

export interface ShopifyConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  storeUrl: string;
  apiVersion: string;
}

// ============================================
// EXPRESS AUGMENTATION
// ============================================

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
      merchantId?: string;
      apiKey?: string;
    }
  }
}

export default {
  // Exportation par défaut pour faciliter les imports
};