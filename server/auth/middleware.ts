import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { storage } from '../storage';
import { User } from '@shared/schema';

const JWT_SECRET = process.env.JWT_SECRET || 'hackathon-jwt-secret';
const JWT_EXPIRY = '7d'; // 7 days

// Generate JWT token for authenticated users
export const generateToken = (user: User): string => {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

// Verify JWT token and attach user to request
export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return next();
    }
    
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = await storage.getUser(decoded.id);
    
    if (user) {
      // Set the user object on the request
      (req as any).user = user;
    }
    
    next();
  } catch (error) {
    // Invalid token, but don't block the request
    next();
  }
};

// Extract token from Authorization header or cookies
const extractToken = (req: Request): string | null => {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check cookie
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  
  return null;
};

// Middleware to require authentication
export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!(req as any).user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

// Middleware to require admin role
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (
    !(req as any).user ||
    (req as any).user.role !== 'admin'
  ) {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }
  next();
};

// Role-based authorization middleware
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !(req as any).user ||
      !roles.includes((req as any).user.role)
    ) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }
    next();
  };
};