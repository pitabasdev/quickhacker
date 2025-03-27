import { 
  users, teams, teamMembers, problems, submissions, reviews,
  type User, type InsertUser, type Team, type InsertTeam,
  type TeamMember, type InsertTeamMember, type Problem, type InsertProblem,
  type Submission, type InsertSubmission, type Review, type InsertReview
} from "@shared/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, desc, sql } from "drizzle-orm";
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Database connection setup
const connectionString = process.env.DATABASE_URL || '';
const queryClient = postgres(connectionString);
const db = drizzle(queryClient);

// Comprehensive storage interface for all our database operations
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByAuthProviderId(provider: string, providerId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, userData: Partial<User>): Promise<User>;
  
  // Team operations
  getTeam(id: number): Promise<Team | undefined>;
  getTeamsByUserId(userId: number): Promise<Team[]>;
  getTeamsByProblemId(problemId: number): Promise<Team[]>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, teamData: Partial<Team>): Promise<Team>;
  
  // Team members operations
  getTeamMembers(teamId: number): Promise<User[]>;
  addTeamMember(teamMember: InsertTeamMember): Promise<TeamMember>;
  removeTeamMember(teamId: number, userId: number): Promise<void>;
  
  // Problem operations
  getProblem(id: number): Promise<Problem | undefined>;
  getProblemBySlug(slug: string): Promise<Problem | undefined>;
  getProblems(): Promise<Problem[]>;
  getActiveProblems(): Promise<Problem[]>;
  createProblem(problem: InsertProblem): Promise<Problem>;
  updateProblem(id: number, problemData: Partial<Problem>): Promise<Problem>;
  
  // Submission operations
  getSubmission(id: number): Promise<Submission | undefined>;
  getSubmissionsByTeamId(teamId: number): Promise<Submission[]>;
  getSubmissionsByProblemId(problemId: number): Promise<Submission[]>;
  createSubmission(submission: InsertSubmission): Promise<Submission>;
  updateSubmission(id: number, submissionData: Partial<Submission>): Promise<Submission>;
  
  // Review operations
  getReviewsBySubmissionId(submissionId: number): Promise<Review[]>;
  createReview(review: InsertReview): Promise<Review>;
  updateReview(id: number, reviewData: Partial<Review>): Promise<Review>;
}

// PostgreSQL database storage implementation
export class PostgresStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result.length ? result[0] : undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result.length ? result[0] : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email));
    return result.length ? result[0] : undefined;
  }

  async getUserByAuthProviderId(provider: string, providerId: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(
      and(
        eq(users.authProvider, provider as any),
        eq(users.authProviderId, providerId)
      )
    );
    return result.length ? result[0] : undefined;
  }

  async createUser(userData: InsertUser): Promise<User> {
    // Hash password if it exists
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
    }

    // Determine auth provider based on authProviderId
    const authProvider = userData.authProviderId ? 'github' : 'local';
    
    // Create full user data with provider type
    const fullUserData = {
      ...userData,
      authProvider: authProvider
    };

    const result = await db.insert(users).values(fullUserData as any).returning();
    return result[0];
  }

  async updateUser(id: number, userData: Partial<User>): Promise<User> {
    // Hash password if it's being updated
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
    }

    // If authProviderId is being updated, also update authProvider
    let authProviderUpdate = {};
    if (userData.authProviderId) {
      authProviderUpdate = { authProvider: 'github' };
    }

    // Set updatedAt to now
    const updatedData = {
      ...userData,
      ...authProviderUpdate,
      updatedAt: new Date()
    };

    const result = await db
      .update(users)
      .set(updatedData)
      .where(eq(users.id, id))
      .returning();
    
    return result[0];
  }

  // Team operations
  async getTeam(id: number): Promise<Team | undefined> {
    const result = await db.select().from(teams).where(eq(teams.id, id));
    return result.length ? result[0] : undefined;
  }

  async getTeamsByUserId(userId: number): Promise<Team[]> {
    // Get teams where the user is a member using the junction table
    const result = await db
      .select()
      .from(teams)
      .innerJoin(teamMembers, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, userId));
    
    return result.map(r => r.teams);
  }

  async getTeamsByProblemId(problemId: number): Promise<Team[]> {
    const result = await db
      .select()
      .from(teams)
      .where(eq(teams.problemId, problemId));
    
    return result;
  }

  async createTeam(teamData: InsertTeam): Promise<Team> {
    const result = await db.insert(teams).values(teamData).returning();
    return result[0];
  }

  async updateTeam(id: number, teamData: Partial<Team>): Promise<Team> {
    // Set updatedAt to now
    const updatedData = {
      ...teamData,
      updatedAt: new Date()
    };

    const result = await db
      .update(teams)
      .set(updatedData)
      .where(eq(teams.id, id))
      .returning();
    
    return result[0];
  }

  // Team members operations
  async getTeamMembers(teamId: number): Promise<User[]> {
    const result = await db
      .select()
      .from(users)
      .innerJoin(teamMembers, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId));
    
    return result.map(r => r.users);
  }

  async addTeamMember(teamMemberData: InsertTeamMember): Promise<TeamMember> {
    const result = await db.insert(teamMembers).values(teamMemberData).returning();
    return result[0];
  }

  async removeTeamMember(teamId: number, userId: number): Promise<void> {
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId)
        )
      );
  }

  // Problem operations
  async getProblem(id: number): Promise<Problem | undefined> {
    const result = await db.select().from(problems).where(eq(problems.id, id));
    return result.length ? result[0] : undefined;
  }

  async getProblemBySlug(slug: string): Promise<Problem | undefined> {
    const result = await db.select().from(problems).where(eq(problems.slug, slug));
    return result.length ? result[0] : undefined;
  }

  async getProblems(): Promise<Problem[]> {
    return await db.select().from(problems);
  }

  async getActiveProblems(): Promise<Problem[]> {
    return await db.select().from(problems).where(eq(problems.isActive, true));
  }

  async createProblem(problemData: InsertProblem): Promise<Problem> {
    const result = await db.insert(problems).values(problemData).returning();
    return result[0];
  }

  async updateProblem(id: number, problemData: Partial<Problem>): Promise<Problem> {
    // Set updatedAt to now
    const updatedData = {
      ...problemData,
      updatedAt: new Date()
    };

    const result = await db
      .update(problems)
      .set(updatedData)
      .where(eq(problems.id, id))
      .returning();
    
    return result[0];
  }

  // Submission operations
  async getSubmission(id: number): Promise<Submission | undefined> {
    const result = await db.select().from(submissions).where(eq(submissions.id, id));
    return result.length ? result[0] : undefined;
  }

  async getSubmissionsByTeamId(teamId: number): Promise<Submission[]> {
    return await db
      .select()
      .from(submissions)
      .where(eq(submissions.teamId, teamId))
      .orderBy(desc(submissions.updatedAt));
  }

  async getSubmissionsByProblemId(problemId: number): Promise<Submission[]> {
    return await db
      .select()
      .from(submissions)
      .where(eq(submissions.problemId, problemId))
      .orderBy(desc(submissions.updatedAt));
  }

  async createSubmission(submissionData: InsertSubmission): Promise<Submission> {
    const result = await db.insert(submissions).values(submissionData).returning();
    return result[0];
  }

  async updateSubmission(id: number, submissionData: Partial<Submission>): Promise<Submission> {
    // Set updatedAt to now and submittedAt if status is changed to submitted
    const updatedData: any = {
      ...submissionData,
      updatedAt: new Date()
    };
    
    if (submissionData.status === 'submitted' && !submissionData.submittedAt) {
      updatedData.submittedAt = new Date();
    }

    const result = await db
      .update(submissions)
      .set(updatedData)
      .where(eq(submissions.id, id))
      .returning();
    
    return result[0];
  }

  // Review operations
  async getReviewsBySubmissionId(submissionId: number): Promise<Review[]> {
    return await db
      .select()
      .from(reviews)
      .where(eq(reviews.submissionId, submissionId));
  }

  async createReview(reviewData: InsertReview): Promise<Review> {
    const result = await db.insert(reviews).values(reviewData).returning();
    return result[0];
  }

  async updateReview(id: number, reviewData: Partial<Review>): Promise<Review> {
    // Set updatedAt to now
    const updatedData = {
      ...reviewData,
      updatedAt: new Date()
    };

    const result = await db
      .update(reviews)
      .set(updatedData)
      .where(eq(reviews.id, id))
      .returning();
    
    return result[0];
  }
}

// Export the storage instance
export const storage = new PostgresStorage();
