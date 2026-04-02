import axios from 'axios';
import logger from '../config/logger';

export interface PaymentResult {
  success: boolean;
  transaction_id?: string;
  reference?: string;
  error?: string;
  provider_response?: any;  // Rendre optionnel avec '?'
  requires_confirmation?: boolean;
}

export const processMobileMoneyPayment = async (
  payment: any,
  confirmationCode?: string
): Promise<PaymentResult> => {
  try {
    if (process.env.NODE_ENV === 'development') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (Math.random() > 0.1) {
        return {
          success: true,
          transaction_id: `SIM_${Date.now()}_${payment.id}`,
          reference: payment.reference,
          provider_response: {
            status: 'SUCCESS',
            message: 'Payment processed successfully',
            transaction_id: `SIM_${Date.now()}_${payment.id}`,
            reference: payment.reference,
            timestamp: new Date().toISOString()
          }
        };
      } else {
        return {
          success: false,
          error: 'Insufficient balance',
          provider_response: {
            status: 'FAILED',
            error: 'INSUFFICIENT_FUNDS',
            message: 'Insufficient balance',
            timestamp: new Date().toISOString()
          }
        };
      }
    }

    switch (payment.method) {
      case 'MVOLA':
        return await processMvolaPayment(payment, confirmationCode);
      case 'ORANGE':
        return await processOrangePayment(payment, confirmationCode);
      case 'AIRTEL':
        return await processAirtelPayment(payment, confirmationCode);
      default:
        return {
          success: false,
          error: 'Unsupported payment method',
          provider_response: {
            error: 'Unsupported payment method',
            method: payment.method,
            timestamp: new Date().toISOString()
          }
        };
    }

  } catch (error) {
    logger.error('Mobile money processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      provider_response: {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    };
  }
};

const processMvolaPayment = async (payment: any, confirmationCode?: string): Promise<PaymentResult> => {
  try {
    const token = await getMvolaToken();
    
    const response = await axios.post(
      `${process.env.MVOLA_API_URL}/payment/v1.0/transactions`,
      {
        amount: payment.amount,
        currency: 'MGA',
        debtorParty: payment.phone,
        creditorParty: process.env.MVOLA_MERCHANT_ID,
        reference: payment.reference,
        description: `Payment for order ${payment.orderId}`
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Callback-URL': `${process.env.BASE_URL}/api/webhooks/mobile-money`
        },
        timeout: 30000
      }
    );

    if (response.data.status === 'SUCCESS' || response.data.status === 'PENDING') {
      return {
        success: true,
        transaction_id: response.data.transactionId || response.data.id,
        reference: payment.reference,
        provider_response: {
          status: response.data.status,
          transaction_id: response.data.transactionId || response.data.id,
          reference: payment.reference,
          message: response.data.message,
          timestamp: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: response.data.message || 'Payment failed',
      provider_response: {
        status: response.data.status,
        error: response.data.message || 'Payment failed',
        transaction_id: response.data.transactionId,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    logger.error('MVola payment error:', error);
    if (axios.isAxiosError(error) && error.response) {
      return {
        success: false,
        error: error.response.data?.message || 'MVola API error',
        provider_response: {
          error: error.response.data?.message || 'MVola API error',
          status: error.response.status,
          data: error.response.data,
          timestamp: new Date().toISOString()
        }
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'MVola payment failed',
      provider_response: {
        error: error instanceof Error ? error.message : 'MVola payment failed',
        timestamp: new Date().toISOString()
      }
    };
  }
};

const processOrangePayment = async (payment: any, confirmationCode?: string): Promise<PaymentResult> => {
  try {
    const token = await getOrangeToken();
    
    const response = await axios.post(
      `${process.env.ORANGE_API_URL}/orange-money/api/v1/payments`,
      {
        amount: payment.amount,
        phone_number: payment.phone,
        reference: payment.reference,
        description: `Order ${payment.orderId}`
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return {
      success: true,
      transaction_id: response.data.transaction_id,
      reference: payment.reference,
      provider_response: {
        status: response.data.status,
        transaction_id: response.data.transaction_id,
        reference: payment.reference,
        message: response.data.message,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    logger.error('Orange payment error:', error);
    if (axios.isAxiosError(error) && error.response) {
      return {
        success: false,
        error: error.response.data?.message || 'Orange API error',
        provider_response: {
          error: error.response.data?.message || 'Orange API error',
          status: error.response.status,
          data: error.response.data,
          timestamp: new Date().toISOString()
        }
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Orange payment failed',
      provider_response: {
        error: error instanceof Error ? error.message : 'Orange payment failed',
        timestamp: new Date().toISOString()
      }
    };
  }
};

const processAirtelPayment = async (payment: any, confirmationCode?: string): Promise<PaymentResult> => {
  try {
    const token = await getAirtelToken();
    
    const response = await axios.post(
      `${process.env.AIRTEL_API_URL}/payments/v1/transactions`,
      {
        amount: payment.amount,
        currency: 'MGA',
        subscriber: payment.phone,
        reference: payment.reference,
        transaction_type: 'merchant_payment'
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return {
      success: true,
      transaction_id: response.data.transaction_id,
      reference: payment.reference,
      provider_response: {
        status: response.data.status,
        transaction_id: response.data.transaction_id,
        reference: payment.reference,
        message: response.data.message,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    logger.error('Airtel payment error:', error);
    if (axios.isAxiosError(error) && error.response) {
      return {
        success: false,
        error: error.response.data?.message || 'Airtel API error',
        provider_response: {
          error: error.response.data?.message || 'Airtel API error',
          status: error.response.status,
          data: error.response.data,
          timestamp: new Date().toISOString()
        }
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Airtel payment failed',
      provider_response: {
        error: error instanceof Error ? error.message : 'Airtel payment failed',
        timestamp: new Date().toISOString()
      }
    };
  }
};

const getMvolaToken = async (): Promise<string> => {
  try {
    const response = await axios.post(
      `${process.env.MVOLA_API_URL}/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.MVOLA_CLIENT_ID!,
        client_secret: process.env.MVOLA_CLIENT_SECRET!
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    return response.data.access_token;
  } catch (error) {
    logger.error('Error getting MVola token:', error);
    throw new Error('Failed to authenticate with MVola');
  }
};

const getOrangeToken = async (): Promise<string> => {
  try {
    const response = await axios.post(
      `${process.env.ORANGE_API_URL}/oauth/v2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.ORANGE_CLIENT_ID!,
        client_secret: process.env.ORANGE_CLIENT_SECRET!
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    return response.data.access_token;
  } catch (error) {
    logger.error('Error getting Orange token:', error);
    throw new Error('Failed to authenticate with Orange Money');
  }
};

const getAirtelToken = async (): Promise<string> => {
  try {
    const response = await axios.post(
      `${process.env.AIRTEL_API_URL}/auth/v1/token`,
      {
        client_id: process.env.AIRTEL_CLIENT_ID,
        client_secret: process.env.AIRTEL_CLIENT_SECRET,
        grant_type: 'client_credentials'
      },
      {
        timeout: 10000
      }
    );

    return response.data.access_token;
  } catch (error) {
    logger.error('Error getting Airtel token:', error);
    throw new Error('Failed to authenticate with Airtel Money');
  }
};