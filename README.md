# Burg AI 🤖

**Burg AI** is an intelligent GitHub App that provides automated AI-powered code reviews for pull requests. It leverages advanced language models to analyze code changes, identify potential issues, and provide actionable feedback directly on your GitHub pull requests.

## 🌟 Features

- **Automated PR Reviews**: Automatically reviews pull requests when they're opened or updated
- **AI-Powered Analysis**: Uses Google's Gemini models via OpenRouter for intelligent code analysis
- **Severity Classification**: Comments are categorized by severity (critical, major, minor)
- **Framework Detection**: Automatically detects project frameworks and applies context-aware reviews
- **Historical Context**: Leverages past reviews to provide consistent feedback
- **Usage Limits**: Built-in rate limiting (10 reviews/month, 3 reviews/day per user)
- **GitHub OAuth**: Secure authentication via GitHub
- **Queue System**: Robust job processing with BullMQ and Redis
- **Structured Feedback**: Provides detailed rationale and suggestions for each issue

## 🏗️ Architecture

### Backend (Node.js + TypeScript + Express)
- **Framework**: Express.js with TypeScript
- **Database**: MongoDB (via Mongoose)
- **Queue**: BullMQ with Redis for background job processing
- **Authentication**: GitHub OAuth with JWT tokens
- **AI Integration**: OpenRouter API with Gemini models
- **Webhooks**: GitHub App webhook handling for PR events

### Frontend (Next.js 15)
- **Framework**: Next.js 15 with React 19
- **Styling**: TailwindCSS v4
- **TypeScript**: Full type safety
- **Turbopack**: Fast development builds

### Key Components

#### Backend Services
- **GitHub Integration**: Handles GitHub App authentication and API interactions
- **AI Review Service**: Generates structured code reviews using LLMs
- **Queue System**: Processes PR reviews asynchronously
- **Usage Tracking**: Monitors and enforces usage limits
- **Webhook Handler**: Processes GitHub webhook events

#### Data Models
- **User**: GitHub user information and usage tracking
- **Installation**: GitHub App installation records
- **PullRequest**: PR metadata and review history
- **AIReview**: Structured AI-generated reviews
- **QueueTask**: Background job tracking

## 📋 Prerequisites

- **Node.js**: v20 or higher
- **MongoDB**: Running instance (local or cloud)
- **Redis**: For queue management
- **GitHub App**: Configured GitHub App with appropriate permissions
- **OpenRouter API Key**: For AI model access

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/rishabhguptajs/burg-ai.git
cd burg-ai
```

### 2. Backend Setup

#### Install Dependencies

```bash
cd server
npm install
```

#### Environment Configuration

Create a `.env` file in the `server` directory:

```bash
# Server Configuration
PORT=3001
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL=http://localhost:3000

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/burg-ai
DB_NAME=burg-ai

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# GitHub OAuth Configuration
GITHUB_CLIENT_ID=your-github-oauth-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-client-secret

# GitHub App Configuration
GITHUB_APP_ID=your-github-app-id
GITHUB_APP_PRIVATE_KEY_PATH=./github-app-private-key.pem
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# OpenRouter Configuration
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free
OPENROUTER_SITE_URL=http://localhost:3001
OPENROUTER_APP_NAME=burg-ai

# Usage Limits
MONTHLY_REVIEW_LIMIT=10
DAILY_REVIEW_LIMIT=3
```

#### GitHub App Setup

1. Create a new GitHub App at https://github.com/settings/apps/new
2. Configure the following permissions:
   - **Repository permissions**:
     - Pull requests: Read & Write
     - Contents: Read
     - Metadata: Read
   - **Subscribe to events**:
     - Pull request
     - Installation
3. Generate a private key and save it as `github-app-private-key.pem` in the `server` directory
4. Set the webhook URL to `https://your-domain.com/webhook/github`
5. Note your App ID and Webhook Secret

#### Start the Backend

```bash
# Development mode with auto-reload
npm run dev:watch

# Or standard development mode
npm run dev

# Production build
npm run build
npm start
```

The backend will start on `http://localhost:3001`

### 3. Frontend Setup

#### Install Dependencies

```bash
cd client
npm install
```

#### Environment Configuration

Create a `.env.local` file in the `client` directory:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

#### Start the Frontend

```bash
# Development mode with Turbopack
npm run dev

# Production build
npm run build
npm start
```

The frontend will start on `http://localhost:3000`

## 🔧 Configuration

### MongoDB Setup

**Local MongoDB:**
```bash
# Install MongoDB (macOS)
brew install mongodb-community

# Start MongoDB
brew services start mongodb-community
```

**MongoDB Atlas (Cloud):**
1. Create a free cluster at https://www.mongodb.com/cloud/atlas
2. Get your connection string
3. Update `MONGODB_URI` in `.env`

### Redis Setup

**Local Redis:**
```bash
# Install Redis (macOS)
brew install redis

# Start Redis
brew services start redis
```

**Redis Cloud:**
1. Create a free instance at https://redis.com/try-free/
2. Update Redis configuration in `.env`

### OpenRouter Setup

1. Sign up at https://openrouter.ai/
2. Generate an API key
3. Add credits to your account
4. Update `OPENROUTER_API_KEY` in `.env`

## 📚 API Endpoints

### Authentication
- `GET /auth/github` - Initiate GitHub OAuth flow
- `GET /auth/github/callback` - OAuth callback handler
- `GET /auth/me` - Get current user info (requires auth)
- `POST /auth/refresh` - Refresh access token
- `POST /auth/associate-installations` - Link GitHub App installations to user

### Webhooks
- `POST /webhook/github` - GitHub webhook handler

### Health
- `GET /health` - Server health check

## 🛠️ Development

### Project Structure

```
burg-ai/
├── client/                 # Next.js frontend
│   ├── src/
│   │   └── app/           # Next.js app directory
│   ├── public/            # Static assets
│   └── package.json
│
└── server/                # Express backend
    ├── src/
    │   ├── config/        # Configuration files
    │   ├── middleware/    # Express middleware
    │   ├── models/        # Mongoose models
    │   ├── routes/        # API routes
    │   ├── types/         # TypeScript types
    │   ├── utils/         # Utility functions
    │   │   ├── ai.ts              # AI service wrapper
    │   │   ├── gemini-llm.ts      # Gemini LLM integration
    │   │   ├── enhanced-ai-review.ts  # Enhanced review logic
    │   │   ├── github.ts          # GitHub API client
    │   │   ├── queue.ts           # BullMQ queue management
    │   │   └── ...
    │   ├── prompts/       # AI prompts
    │   └── index.ts       # Server entry point
    └── package.json
```

### Running Tests

```bash
# Backend tests (when implemented)
cd server
npm test

# Frontend tests (when implemented)
cd client
npm test
```

### Code Quality

```bash
# Lint backend
cd server
npm run lint

# Lint frontend
cd client
npm run lint
```

## 🔐 Security

- **Environment Variables**: Never commit `.env` files
- **Private Keys**: Keep GitHub App private key secure
- **JWT Secrets**: Use strong, random secrets in production
- **HTTPS**: Always use HTTPS in production
- **Rate Limiting**: Built-in usage limits prevent abuse

## 📊 Usage Limits

Default limits (configurable via environment variables):
- **Monthly**: 10 reviews per user
- **Daily**: 3 reviews per user

Limits reset automatically based on the reset dates stored in the user model.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- **OpenRouter** for AI model access
- **Google Gemini** for powerful language models
- **GitHub** for the amazing API and App platform
- **BullMQ** for robust job queue management

## 📧 Support

For issues, questions, or contributions, please open an issue on GitHub.

---
**Built by [Rishabh Gupta](https://github.com/rishabhguptajs)**
