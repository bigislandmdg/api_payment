import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import logger from '../config/logger';

export interface AuthRequest extends Request {
  user?: any;
  merchantId?: string;
}

export const verifySignature = (req: Request, res: Response, next: NextFunction) => {
  // Désactiver la vérification de signature en développement
  if (process.env.NODE_ENV === 'development') {
    console.log('⚠️ [DEV MODE] Signature verification disabled');
    return next();
  }

  const signature = req.headers['x-signature'] as string;
  const timestamp = req.headers['x-timestamp'] as string;
  const secret = process.env.SECRET_KEY;

  if (!signature || !timestamp) {
    return res.status(401).json({
      success: false,
      error: 'Missing signature headers',
      code: 'MISSING_SIGNATURE'
    });
  }

  const now = Date.now();
  const requestTime = parseInt(timestamp);
  
  if (Math.abs(now - requestTime) > 300000) {
    return res.status(401).json({
      success: false,
      error: 'Request expired',
      code: 'REQUEST_EXPIRED'
    });
  }

  const payload = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', secret!)
    .update(timestamp + payload)
    .digest('hex');

  if (hash !== signature) {
    logger.warn(`Invalid signature from ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: 'Invalid signature',
      code: 'INVALID_SIGNATURE'
    });
  }

  next();
};

export const verifyJWT = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Désactiver la vérification JWT en développement
  if (process.env.NODE_ENV === 'development') {
    console.log('⚠️ [DEV MODE] JWT verification disabled');
    // Ajouter un utilisateur fictif pour le développement
    req.user = {
      id: 'dev-user-id',
      email: 'dev@voaray.com',
      role: 'admin'
    };
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'No token provided',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
};

export const verifyApiKey = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Désactiver la vérification API Key en développement
  if (process.env.NODE_ENV === 'development') {
    console.log('⚠️ [DEV MODE] API Key verification disabled');
    req.merchantId = 'dev-merchant-id';
    return next();
  }

  const apiKey = req.headers['x-api-key'] as string;
  const apiSecret = req.headers['x-api-secret'] as string;

  if (!apiKey || !apiSecret) {
    return res.status(401).json({
      success: false,
      error: 'Missing API credentials',
      code: 'MISSING_CREDENTIALS'
    });
  }

  try {
    const key = await prisma.apiKey.findUnique({
      where: { key: apiKey }
    });

    if (!key || !key.active || key.secret !== apiSecret) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (key.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'API key expired',
        code: 'KEY_EXPIRED'
      });
    }

    req.merchantId = key.merchantId;
    next();
  } catch (error) {
    logger.error('API key verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
};