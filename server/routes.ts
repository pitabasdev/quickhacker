import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import passport from "passport";
import { authenticateJWT, requireAuth, requireAdmin, requireRole, setupAuth, hashPassword } from "./auth";
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { 
  insertUserSchema, 
  insertTeamSchema, 
  insertTeamMemberSchema, 
  insertProblemSchema, 
  insertSubmissionSchema, 
  insertReviewSchema,
  User,
  Review
} from '@shared/schema';

// Extend Request with custom user type
interface AuthRequest extends Request {
  user?: any; // Using any for simplicity to avoid type conflicts
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Setup WebSocket Server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // WebSocket connection handler
  wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocket message received:', data);

        // Handle different message types
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }

        // Broadcast to all clients
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === ws.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });

    // Send a welcome message
    ws.send(JSON.stringify({ 
      type: 'welcome', 
      message: 'Connected to Quickhacker WebSocket server',
      timestamp: new Date().toISOString()
    }));
  });

  // Middleware to handle errors
  const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: err.message || 'Something went wrong'
    });
  };

  // Authentication routes
  app.post('/api/auth/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);
      
      // Check if email or username already exists
      const existingUserByEmail = await storage.getUserByEmail(validatedData.email);
      if (existingUserByEmail) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      
      const existingUserByUsername = await storage.getUserByUsername(validatedData.username);
      if (existingUserByUsername) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      
      const newUser = await storage.createUser(validatedData);
      res.status(201).json({ id: newUser.id, username: newUser.username, email: newUser.email });
    } catch (error) {
      next(error);
    }
  });

  // Auth login route is handled in auth.ts

  app.get('/api/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

  app.get('/api/auth/github/callback', 
    passport.authenticate('github', { session: false, failureRedirect: '/login' }),
    (req: AuthRequest, res: Response) => {
      const { generateToken } = require('./auth/middleware');
      const token = generateToken(req.user as User);
      
      // Redirect to frontend with token
      res.redirect(`/?token=${token}`);
    }
  );

  // Auth /me route is handled in auth.ts

  // User routes
  app.get('/api/users/:id', authenticateJWT, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await storage.getUser(parseInt(req.params.id));
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Remove sensitive information
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/users/:id', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.params.id);
      
      // Only allow users to update their own profile, or admins to update any profile
      if (req.user?.id !== userId && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      const updatedUser = await storage.updateUser(userId, req.body);
      const { password, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      next(error);
    }
  });

  // Team routes
  app.get('/api/teams', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get query parameters
      const problemId = req.query.problemId ? parseInt(req.query.problemId as string) : undefined;
      const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
      
      let teams = [];
      
      if (problemId) {
        teams = await storage.getTeamsByProblemId(problemId);
      } else if (userId) {
        teams = await storage.getTeamsByUserId(userId);
      } else {
        // No filter - would need pagination in a real app
        // For hackathon, we can return all teams as the numbers will be manageable
        teams = await storage.getTeamsByProblemId(0); // This will return all teams
      }
      
      res.json(teams);
    } catch (error) {
      next(error);
    }
  });

  // Mock team data for demo account
  const mockTeam = {
    id: 101,
    name: "Cyber Innovators",
    problemId: 3, // Cybersecurity Challenge
    problemTitle: "Cybersecurity Challenge: Zero Trust Architecture",
    status: "approved",
    createdAt: new Date().toISOString(),
    members: [
      {
        id: 1,
        name: "John Doe",
        email: "cyberinnovators_team@example.com",
        role: "Team Leader",
        avatar: null
      },
      {
        id: 2,
        name: "Jane Smith",
        email: "jane.smith@example.com",
        role: "Security Specialist",
        avatar: null
      },
      {
        id: 3,
        name: "Alex Chen",
        email: "alex.chen@example.com",
        role: "Full-Stack Developer",
        avatar: null
      }
    ],
    submissions: [
      {
        id: 201,
        problemId: 3,
        problemTitle: "Cybersecurity Challenge: Zero Trust Architecture",
        submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
        status: "under_review",
        githubUrl: "https://github.com/cyberinnovators/zero-trust-solution",
        demoUrl: "https://zerotrust.cyberinnovators.dev",
        description: "Our solution implements a comprehensive zero-trust architecture that continuously verifies identity and applies least-privilege access controls. We've built a simulated enterprise environment demonstrating real-time threat detection and automated response mechanisms.",
        techStack: ["Node.js", "React", "Docker", "AWS", "OAuth 2.0", "Kubernetes"],
        feedback: "Great implementation of the zero-trust model. The judges were impressed with your real-time threat detection capabilities. Consider improving the user onboarding experience for non-technical administrators."
      }
    ]
  };

  app.get('/api/teams/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Special case for demo team user with id=1
      if (req.headers.authorization?.includes('cyberinnovators_team')) {
        return res.json(mockTeam);
      }
      
      const team = await storage.getTeam(parseInt(req.params.id));
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Get team members
      const members = await storage.getTeamMembers(team.id);
      
      res.json({ ...team, members });
    } catch (error) {
      next(error);
    }
  });
  
  // Get a team with all its details (members, problem, submissions)
  app.get('/api/teams/:id/details', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeam(teamId);
      
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Get all team members
      const members = await storage.getTeamMembers(teamId);
      
      // Get the team's problem details if it's assigned to one
      let problem = null;
      if (team.problemId) {
        problem = await storage.getProblem(team.problemId);
      }
      
      // Get team's submissions
      const submissions = await storage.getSubmissionsByTeamId(teamId);
      
      // Get reviews for each submission
      const submissionsWithReviews = await Promise.all(
        submissions.map(async (submission) => {
          const reviews = await storage.getReviewsBySubmissionId(submission.id);
          return {
            ...submission,
            reviews
          };
        })
      );
      
      res.json({
        ...team,
        members,
        problem,
        submissions: submissionsWithReviews
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/teams', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validatedData = insertTeamSchema.parse(req.body);
      
      // Create the team
      const newTeam = await storage.createTeam(validatedData);
      
      // Add the current user as team leader
      if (req.user) {
        await storage.addTeamMember({
          teamId: newTeam.id,
          userId: req.user.id,
          isLeader: true
        });
      }
      
      res.status(201).json(newTeam);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/teams/:id', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeam(teamId);
      
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Check if user is a team leader or admin
      const teamMembers = await storage.getTeamMembers(teamId);
      const userIsLeader = teamMembers.some(member => 
        member.id === req.user?.id && 
        member.id === req.user?.id
      );
      
      // If it's an admin action like approving/rejecting a team, allow it
      const isAdminAction = req.body.hasOwnProperty('status') && req.user?.role === 'admin';
      
      if (!userIsLeader && !isAdminAction) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      const updatedTeam = await storage.updateTeam(teamId, req.body);
      res.json(updatedTeam);
    } catch (error) {
      next(error);
    }
  });
  
  // Team approval endpoint
  app.post('/api/teams/:id/approve', authenticateJWT, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeam(teamId);
      
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Update team status to approved
      const updatedTeam = await storage.updateTeam(teamId, { status: 'approved' });
      res.json(updatedTeam);
    } catch (error) {
      next(error);
    }
  });
  
  // Team rejection endpoint
  app.post('/api/teams/:id/reject', authenticateJWT, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeam(teamId);
      
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Update team status to rejected
      const updatedTeam = await storage.updateTeam(teamId, { status: 'rejected' });
      res.json(updatedTeam);
    } catch (error) {
      next(error);
    }
  });
  
  // Generate team credentials endpoint
  app.post('/api/teams/:id/credentials', authenticateJWT, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeam(teamId);
      
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Check if this team is approved
      if (team.status !== 'approved') {
        return res.status(400).json({ error: 'Only approved teams can have credentials generated' });
      }
      
      // Generate a friendly username based on team name
      const username = team.name.toLowerCase().replace(/\s+/g, '') + '_team';
      
      // Generate a random secure password
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
      let password = '';
      for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      // In a real app, you would save these credentials securely
      // and/or create/update a user with these credentials
      
      res.json({
        teamId: team.id,
        username, 
        password
      });
    } catch (error) {
      next(error);
    }
  });

  // Team registration endpoint with member details
  app.post('/api/register-team', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { team, leader, members } = req.body;
      
      // First check if we have at least one female member (including leader)
      const hasFemaleMember = 
        (leader.gender === 'female') || 
        members.some((member: any) => member.gender === 'female');
      
      if (!hasFemaleMember) {
        return res.status(400).json({ error: 'At least one female team member is required' });
      }
      
      // Create team record
      const newTeam = await storage.createTeam({
        name: team.name,
        problemId: team.problemId,
        description: team.description,
      });
      
      // Create leader user account with generated credentials
      const leaderUsername = generateUsername(team.name) + '_leader';
      const leaderPassword = generatePassword(12);
      
      // Create leader user account with proper values from the schema
      const leaderUser = await storage.createUser({
        username: leaderUsername,
        email: leader.email,
        password: await hashPassword(leaderPassword),
        name: leader.name,
        profilePicture: null,
        // These fields will use the defaults defined in the schema
      });
      
      // Add leader to team
      await storage.addTeamMember({
        teamId: newTeam.id,
        userId: leaderUser.id,
        isLeader: true,
        gender: leader.gender,
      });
      
      // Create member accounts and add to team
      const memberAccounts = [];
      for (const member of members) {
        // Type the username correctly to avoid TypeScript error
        const memberUsername: string = generateUsername(team.name) + '_member' + (memberAccounts.length + 1);
        const memberPassword = generatePassword(10);
        
        // Create user account with values that adhere to the schema
        const memberUser = await storage.createUser({
          username: memberUsername,
          email: member.email,
          password: await hashPassword(memberPassword),
          name: member.name,
          profilePicture: null,
          // Other fields will use schema defaults
        });
        
        // Add to team
        await storage.addTeamMember({
          teamId: newTeam.id,
          userId: memberUser.id,
          isLeader: false,
          gender: member.gender,
        });
        
        memberAccounts.push({
          name: member.name,
          username: memberUsername,
          // We don't return member passwords to avoid security issues
        });
      }
      
      res.status(201).json({
        success: true,
        team: {
          id: newTeam.id,
          name: newTeam.name,
          status: newTeam.status,
        },
        leader: {
          name: leader.name,
          username: leaderUsername,
          password: leaderPassword,
          instructions: "These are your team leader credentials. Store them securely. You'll need them to log in to your team dashboard once your team is approved by administrators."
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Helper functions for team registration
  function generateUsername(teamName: string) {
    return `${teamName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  function generatePassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }
  
  // Team member routes
  app.post('/api/teams/:teamId/members', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const teamId = parseInt(req.params.teamId);
      const { userId, isLeader = false } = req.body;
      
      // Validate team exists
      const team = await storage.getTeam(teamId);
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Check if user is a team leader or admin
      const teamMembers = await storage.getTeamMembers(teamId);
      const userIsLeader = teamMembers.some(member => 
        member.id === req.user?.id && 
        member.id === req.user?.id
      );
      
      if (!userIsLeader && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      // Add new member
      const newMember = await storage.addTeamMember({
        teamId,
        userId: parseInt(userId),
        isLeader
      });
      
      res.status(201).json(newMember);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/teams/:teamId/members/:userId', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const teamId = parseInt(req.params.teamId);
      const userId = parseInt(req.params.userId);
      
      // Validate team exists
      const team = await storage.getTeam(teamId);
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Check if user is a team leader, the member being removed, or admin
      const teamMembers = await storage.getTeamMembers(teamId);
      const userIsLeader = teamMembers.some(member => 
        member.id === req.user?.id && 
        member.id === req.user?.id
      );
      
      if (req.user?.id !== userId && !userIsLeader && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      // Remove member
      await storage.removeTeamMember(teamId, userId);
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Problem routes
  app.get('/api/problems', async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('GET /api/problems - Query params:', req.query);
      const active = req.query.active === 'true';
      
      let problems;
      if (active) {
        console.log('Fetching active problems');
        problems = await storage.getActiveProblems();
      } else {
        console.log('Fetching all problems');
        problems = await storage.getProblems();
      }
      
      console.log(`Found ${problems.length} problems`);
      
      // Return mock problems if no problems found (for demonstration purposes)
      if (problems.length === 0) {
        problems = [
          {
            id: 1,
            title: "AI Chatbot Challenge",
            slug: "ai-chatbot-challenge",
            category: "AI & ML",
            description: "Build an intelligent chatbot that can understand and respond to user queries related to hackathon information.",
            longDescription: "Create a conversational AI that can handle complex queries about hackathon rules, scheduling, and provide technical assistance to participants.",
            difficultyLevel: 3,
            prizeAmount: "$5,000",
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: 2,
            title: "Healthcare Data Analytics",
            slug: "healthcare-data-analytics",
            category: "Healthcare",
            description: "Develop a solution that analyzes healthcare data to predict potential health risks and provide preventive recommendations.",
            longDescription: "Use machine learning algorithms to analyze anonymized patient data and identify patterns that could indicate early signs of diseases.",
            difficultyLevel: 4,
            prizeAmount: "$7,500",
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: 3,
            title: "Cybersecurity Challenge: Zero Trust Architecture",
            slug: "cybersecurity-zero-trust",
            category: "Cybersecurity",
            description: "Implement a zero-trust security model for a simulated enterprise network to protect against modern cyber threats.",
            longDescription: "Design and implement a comprehensive zero-trust architecture that continuously verifies identity, applies least-privilege access, and monitors for anomalies.",
            difficultyLevel: 5,
            prizeAmount: "$10,000",
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ];
        console.log('Returning mock problems for demonstration');
      }
      
      res.json(problems);
    } catch (error) {
      console.error('Error fetching problems:', error);
      next(error);
    }
  });

  app.get('/api/problems/:idOrSlug', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idOrSlug = req.params.idOrSlug;
      let problem;
      
      // Check if the parameter is an ID or slug
      if (!isNaN(parseInt(idOrSlug))) {
        problem = await storage.getProblem(parseInt(idOrSlug));
      } else {
        problem = await storage.getProblemBySlug(idOrSlug);
      }
      
      if (!problem) {
        return res.status(404).json({ error: 'Problem not found' });
      }
      
      res.json(problem);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/problems', authenticateJWT, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = insertProblemSchema.parse(req.body);
      const newProblem = await storage.createProblem(validatedData);
      res.status(201).json(newProblem);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/problems/:id', authenticateJWT, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const problemId = parseInt(req.params.id);
      const updatedProblem = await storage.updateProblem(problemId, req.body);
      res.json(updatedProblem);
    } catch (error) {
      next(error);
    }
  });

  // Submission routes
  app.get('/api/submissions', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Get query parameters
      const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
      const problemId = req.query.problemId ? parseInt(req.query.problemId as string) : undefined;
      
      let submissions = [];
      
      // Filter submissions based on parameters
      if (teamId) {
        submissions = await storage.getSubmissionsByTeamId(teamId);
      } else if (problemId) {
        // Only admins, mentors, or judges can see all submissions for a problem
        if (['admin', 'mentor', 'judge'].includes(req.user?.role || '')) {
          submissions = await storage.getSubmissionsByProblemId(problemId);
        } else {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      } else {
        // Only admins can see all submissions
        if (req.user?.role === 'admin') {
          // In a real app, this would need pagination
          submissions = await storage.getSubmissionsByProblemId(0); // This is a hack to get all submissions
        } else {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      }
      
      res.json(submissions);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/submissions/:id', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const submissionId = parseInt(req.params.id);
      const submission = await storage.getSubmission(submissionId);
      
      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }
      
      // Check if user has permission to view this submission
      if (req.user?.role === 'admin' || req.user?.role === 'judge' || req.user?.role === 'mentor') {
        // Admins, judges, and mentors can view any submission
      } else {
        // Participants can only view submissions from their teams
        const userTeams = await storage.getTeamsByUserId(req.user?.id || 0);
        const hasAccess = userTeams.some(team => team.id === submission.teamId);
        
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      }
      
      // Get reviews if user has permission
      let reviews: Review[] = [];
      if (req.user?.role === 'admin' || req.user?.role === 'judge') {
        reviews = await storage.getReviewsBySubmissionId(submissionId);
      }
      
      res.json({ ...submission, reviews });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/submissions', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validatedData = insertSubmissionSchema.parse(req.body);
      
      // Check if the user is a member of the team
      const userTeams = await storage.getTeamsByUserId(req.user?.id || 0);
      const isMember = userTeams.some(team => team.id === validatedData.teamId);
      
      if (!isMember && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      const newSubmission = await storage.createSubmission(validatedData);
      res.status(201).json(newSubmission);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/submissions/:id', authenticateJWT, requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const submissionId = parseInt(req.params.id);
      const submission = await storage.getSubmission(submissionId);
      
      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }
      
      // Check if user has permission to update this submission
      if (req.user?.role === 'admin') {
        // Admins can update any submission
      } else if (req.user?.role === 'judge' || req.user?.role === 'mentor') {
        // Judges and mentors can only update feedback and score
        const allowedFields = ['feedback', 'score', 'status'];
        const submittedFields = Object.keys(req.body);
        
        const hasDisallowedFields = submittedFields.some(field => !allowedFields.includes(field));
        if (hasDisallowedFields) {
          return res.status(403).json({ error: 'You can only update feedback, score, and status' });
        }
      } else {
        // Participants can only update their team's submissions
        const userTeams = await storage.getTeamsByUserId(req.user?.id || 0);
        const hasAccess = userTeams.some(team => team.id === submission.teamId);
        
        if (!hasAccess) {
          return res.status(403).json({ error: 'Unauthorized' });
        }
        
        // If the submission is already submitted, they can't update it
        if (submission.status !== 'draft' && req.body.status !== 'submitted') {
          return res.status(403).json({ error: 'Cannot update a submission that has been reviewed' });
        }
      }
      
      const updatedSubmission = await storage.updateSubmission(submissionId, req.body);
      res.json(updatedSubmission);
    } catch (error) {
      next(error);
    }
  });

  // Review routes - only accessible to judges and admins
  app.get('/api/submissions/:submissionId/reviews', authenticateJWT, requireRole(['admin', 'judge']), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const submissionId = parseInt(req.params.submissionId);
      const reviews = await storage.getReviewsBySubmissionId(submissionId);
      res.json(reviews);
    } catch (error) {
      next(error);
    }
  });
  
  // Evaluate a submission
  app.post('/api/submissions/:submissionId/evaluate', authenticateJWT, requireRole(['admin', 'judge']), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const submissionId = parseInt(req.params.submissionId);
      const { status, scores, notes } = req.body;

      // Check if submission exists first
      const submission = await storage.getSubmission(submissionId);
      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      // First update the submission status
      const updatedSubmission = await storage.updateSubmission(submissionId, { status });

      // Calculate average score
      const overallScore = (
        scores.innovation + 
        scores.technicalExecution + 
        scores.userExperience + 
        scores.presentation + 
        scores.impact
      ) / 5;
      
      // Then create a review record with the scores and notes
      // Convert numeric scores to Decimal for PostgreSQL
      const review = await storage.createReview({
        submissionId,
        reviewerId: req.user.id,
        technicalScore: scores.technicalExecution.toString(),
        creativityScore: scores.innovation.toString(),
        usabilityScore: scores.userExperience.toString(),
        completenessScore: scores.impact.toString(),
        overallScore: overallScore.toString(),
        comments: notes
      });

      res.status(200).json({
        submission: updatedSubmission,
        review
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/reviews', authenticateJWT, requireRole(['admin', 'judge']), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validatedData = insertReviewSchema.parse({
        ...req.body,
        reviewerId: req.user?.id
      });
      
      const newReview = await storage.createReview(validatedData);
      res.status(201).json(newReview);
      
      // Update the submission status if needed
      const submission = await storage.getSubmission(validatedData.submissionId);
      if (submission && submission.status === 'submitted') {
        await storage.updateSubmission(submission.id, { status: 'under_review' });
      }
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/reviews/:id', authenticateJWT, requireRole(['admin', 'judge']), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const reviewId = parseInt(req.params.id);
      
      // Ensure only the reviewer or an admin can update the review
      const review = await storage.getReviewsBySubmissionId(reviewId); // This is a hack, we should have a getReview method
      const reviewToUpdate = review[0]; // Simplification for now
      
      if (reviewToUpdate && reviewToUpdate.reviewerId !== req.user?.id && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      const updatedReview = await storage.updateReview(reviewId, req.body);
      res.json(updatedReview);
    } catch (error) {
      next(error);
    }
  });

  // Add error handling middleware
  app.use(errorHandler);

  // API fallback for any unmatched routes - must be AFTER all API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return httpServer;
}
