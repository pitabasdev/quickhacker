import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GitHubStrategy } from 'passport-github2';
import bcrypt from 'bcryptjs';
import { Request } from 'express';
import { storage } from '../storage';
import { InsertUser, User, authProviderEnum } from '@shared/schema';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { users } from '@shared/schema';

dotenv.config();

// Configure Local Strategy for username/password login
passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        // Find the user by email
        const user = await storage.getUserByEmail(email);

        // If user not found or using GitHub auth without local password
        if (!user || (user.authProvider === 'github' && !user.password)) {
          return done(null, false, { message: 'Incorrect email or password' });
        }

        // Check password
        if (!user.password || !(await bcrypt.compare(password, user.password))) {
          return done(null, false, { message: 'Incorrect email or password' });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

// Configure GitHub Strategy for OAuth login
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: `${process.env.APP_URL || 'http://localhost:5000'}/api/auth/github/callback`,
        passReqToCallback: true,
      },
      async (req: Request, accessToken: string, refreshToken: string, profile: any, done: any) => {
        try {
          // Check if user already exists with this GitHub ID
          let user = await storage.getUserByAuthProviderId('github', profile.id.toString());

          if (user) {
            // User exists, update their GitHub info if needed
            return done(null, user);
          }

          // No user found with this GitHub ID
          // Check if there's a user with the same email to link accounts
          const emails = profile.emails || [];
          let primaryEmail = '';
          
          if (emails.length > 0) {
            // Find primary email or use the first one
            const primary = emails.find((email: any) => email.primary);
            primaryEmail = primary ? primary.value : emails[0].value;
            
            if (primaryEmail) {
              user = await storage.getUserByEmail(primaryEmail);
            }
          }

          if (user) {
            // Link GitHub to existing account
            const updatedUser = await storage.updateUser(user.id, {
              authProviderId: profile.id.toString(),
              githubUsername: profile.username,
              profilePicture: profile.photos?.[0]?.value || user.profilePicture,
            });
            return done(null, updatedUser);
          }

          // Create a new user
          const newUser: InsertUser = {
            email: primaryEmail,
            username: profile.username || `github_${profile.id}`,
            name: profile.displayName || profile.username,
            authProviderId: profile.id.toString(),
            githubUsername: profile.username,
            profilePicture: profile.photos?.[0]?.value,
          };

          const createdUser = await storage.createUser(newUser);
          return done(null, createdUser);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}

// Serialize user to session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id: number, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export default passport;