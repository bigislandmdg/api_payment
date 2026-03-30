import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';

export const validatePaymentRequest = [
  body('amount')
    .isFloat({ min: 100, max: 10000000 })
    .withMessage('Amount must be between 100 and 10,000,000 Ar'),
  body('order_id')
    .notEmpty()
    .withMessage('Order ID is required')
    .isString()
    .withMessage('Order ID must be a string')
    .trim(),
  body('phone')
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^[0-9]{10}$/)
    .withMessage('Phone number must be 10 digits (e.g., 0341234567)')
    .trim(),
  body('method')
    .isIn(['MVOLA', 'ORANGE', 'AIRTEL'])
    .withMessage('Invalid payment method. Must be MVOLA, ORANGE, or AIRTEL'),
  // return_url est optionnel sans validation
  body('return_url').optional(),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }
    next();
  }
];

export const validateConfirmPayment = [
  body('payment_id')
    .notEmpty()
    .withMessage('Payment ID is required')
    .isUUID()
    .withMessage('Invalid payment ID format'),
  body('confirmation_code')
    .optional()
    .isString()
    .withMessage('Confirmation code must be a string'),
  body('otp')
    .optional()
    .isString()
    .withMessage('OTP must be a string'),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: errors.array()
      });
    }
    next();
  }
];
