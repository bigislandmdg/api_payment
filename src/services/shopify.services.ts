import axios from 'axios';
import logger from '../config/logger';

export interface ShopifyOrder {
  id: number;
  order_number: number;
  total_price: string;
  total_price_usd: string;
  currency: string;
  customer: any;
  line_items: any[];
  financial_status: string;
  fulfillment_status: string;
}

export const updateShopifyOrder = async (orderId: string, status: string): Promise<void> => {
  try {
    if (status === 'SUCCESS') {
      const transaction = await axios.post(
        `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01/orders/${orderId}/transactions.json`,
        {
          transaction: {
            kind: 'capture',
            status: 'success',
            test: process.env.NODE_ENV !== 'production',
            metadata: {
              gateway: 'Voaray Mobile Money',
              source: 'voaray-payment-gateway',
              timestamp: new Date().toISOString()
            }
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      logger.info(`Shopify order ${orderId} marked as paid`, {
        transaction_id: transaction.data.transaction.id
      });
    }
  } catch (error) {
    logger.error(`Error updating Shopify order ${orderId}:`, error);
    throw new Error(`Failed to update Shopify order: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const getShopifyOrder = async (orderId: string): Promise<ShopifyOrder> => {
  try {
    const response = await axios.get(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01/orders/${orderId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
        },
        timeout: 10000
      }
    );

    return response.data.order;
  } catch (error) {
    logger.error(`Error fetching Shopify order ${orderId}:`, error);
    throw new Error(`Failed to fetch Shopify order: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};