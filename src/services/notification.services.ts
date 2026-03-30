import axios from 'axios';
import logger from '../config/logger';

export interface NotificationData {
  email?: string;
  phone?: string;
  message: string;
  type: 'payment_success' | 'payment_failed' | 'payment_pending';
  metadata?: any;
}

export const sendNotification = async (data: NotificationData): Promise<void> => {
  try {
    if (data.email) {
      await sendEmail(data.email, data.type, data.message, data.metadata);
    }

    if (data.phone) {
      await sendSMS(data.phone, data.message, data.type);
    }

    logger.info(`Notification sent for ${data.type}`);
  } catch (error) {
    logger.error('Error sending notification:', error);
  }
};

const sendEmail = async (email: string, type: string, message: string, metadata?: any): Promise<void> => {
  try {
    if (process.env.SENDGRID_API_KEY) {
      await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{ to: [{ email }] }],
          from: { email: process.env.FROM_EMAIL || 'noreply@voaray.com' },
          subject: getEmailSubject(type),
          content: [{ type: 'text/html', value: getEmailTemplate(type, message, metadata) }]
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      logger.info(`Email sent to ${email}`);
    } else {
      logger.info(`[EMAIL MOCK] To: ${email}, Subject: ${getEmailSubject(type)}, Message: ${message}`);
    }
  } catch (error) {
    logger.error(`Error sending email to ${email}:`, error);
  }
};

const sendSMS = async (phone: string, message: string, type: string): Promise<void> => {
  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const client = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      
      await client.messages.create({
        body: message,
        to: phone,
        from: process.env.TWILIO_PHONE_NUMBER
      });
      
      logger.info(`SMS sent to ${phone}`);
    } else {
      logger.info(`[SMS MOCK] To: ${phone}, Message: ${message}`);
    }
  } catch (error) {
    logger.error(`Error sending SMS to ${phone}:`, error);
  }
};

const getEmailSubject = (type: string): string => {
  const subjects = {
    payment_success: '✅ Payment Confirmed - Voaray',
    payment_failed: '❌ Payment Failed - Voaray',
    payment_pending: '⏳ Payment Pending - Voaray'
  };
  return subjects[type as keyof typeof subjects] || 'Payment Notification - Voaray';
};

const getEmailTemplate = (type: string, message: string, metadata?: any): string => {
  const templates = {
    payment_success: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #28a745;">Payment Successful! 🎉</h2>
        <p>Your payment has been confirmed.</p>
        <p><strong>Amount:</strong> ${metadata?.amount || 'N/A'} Ar</p>
        <p><strong>Order ID:</strong> ${metadata?.orderId || 'N/A'}</p>
        <p><strong>Transaction ID:</strong> ${metadata?.transactionId || 'N/A'}</p>
        <p>Thank you for using Voaray!</p>
      </div>
    `,
    payment_failed: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">Payment Failed ❌</h2>
        <p>${message}</p>
        <p>Please try again or contact support.</p>
      </div>
    `,
    payment_pending: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ffc107;">Payment Pending ⏳</h2>
        <p>Your payment is being processed.</p>
        <p>You will receive a confirmation shortly.</p>
      </div>
    `
  };
  return templates[type as keyof typeof templates] || `<p>${message}</p>`;
};