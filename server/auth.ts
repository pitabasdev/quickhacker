import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET || "quickhacker-secret-key";

// Admin and Team credentials (hardcoded as requested)
const ADMIN_EMAIL = "support@quickhacker.org";
const ADMIN_PASSWORD = "Hacker@123";

// Demo team credentials
const TEAM_EMAIL = "cyberinnovators_team@example.com";
const TEAM_PASSWORD = "TeamPass123!";

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string | null) {
  if (!stored) {
    return false;
  }
  
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function generateToken(user: any): string {
  // Create a payload that doesn't include sensitive information
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  };
  
  // Generate a token that expires in 24 hours
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export function authenticateJWT(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  
  const user = verifyToken(token);
  
  if (!user) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  
  req.user = user;
  next();
}

function extractToken(req: Request): string | null {
  if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export function setupAuth(app: Express) {
  // Set up local strategy with passport
  passport.use(new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password'
    },
    async (email, password, done) => {
      try {
        // Special case for admin login
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          // Create a mock admin user with all required fields from SelectUser
          const adminUser: SelectUser = {
            id: 0,
            email: ADMIN_EMAIL,
            name: "Admin",
            username: "admin",
            password: null,
            role: "admin",
            authProvider: "local",
            authProviderId: null,
            bio: null,
            profilePicture: null,
            githubUsername: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          return done(null, adminUser);
        }
        
        // Special case for demo team login
        if (email === TEAM_EMAIL && password === TEAM_PASSWORD) {
          // Create a mock team user with all required fields from SelectUser
          const teamUser: SelectUser = {
            id: 1,
            email: TEAM_EMAIL,
            name: "John Doe",
            username: "cyberinnovators_team",
            password: null,
            role: "participant",
            authProvider: "local",
            authProviderId: null,
            bio: "Team leader for Cyber Innovators",
            profilePicture: null,
            githubUsername: "johndoe",
            createdAt: new Date(),
            updatedAt: new Date()
          };
          return done(null, teamUser);
        }

        // Regular user login
        const user = await storage.getUserByEmail(email);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  ));

  // JWT Authentication routes
  app.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('local', { session: false }, (err: Error, user: any, info: any) => {
      if (err) {
        return next(err);
      }
      
      if (!user) {
        return res.status(401).json({ message: info.message || 'Invalid email or password' });
      }
      
      const token = generateToken(user);
      
      // Check if this is admin or team login
      if (req.body.userType === 'admin' && user.role !== 'admin') {
        return res.status(403).json({ message: 'Not authorized as admin' });
      }
      
      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      });
    })(req, res, next);
  });

  // Register route
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      // Check if user with this email already exists
      const existingUser = await storage.getUserByEmail(req.body.email);
      if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }
      
      // Hash the password
      const hashedPassword = await hashPassword(req.body.password);
      
      // Create the user
      const userData = {
        ...req.body,
        password: hashedPassword,
        role: 'participant', // Default role for new users
      };
      
      const newUser = await storage.createUser(userData);
      
      // Generate token
      const token = generateToken(newUser);
      
      // Return user data and token
      return res.status(201).json({
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({ message: 'Registration failed' });
    }
  });

  // Get current user
  app.get('/api/auth/me', authenticateJWT, (req: Request, res: Response) => {
    return res.json(req.user);
  });

  // Logout endpoint (for client-side token removal)
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    return res.json({ message: 'Logged out successfully' });
  });
}