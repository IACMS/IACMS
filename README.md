# IACMS - Inter-Agency Case Management Platform

Backend API for the Inter-Agency Case Management Platform, a multi-tenant system for managing cases across government organizations.

## Features

- Multi-tenant architecture with tenant isolation
- Role-based access control (RBAC)
- Configurable workflow engine
- Case management with assignment and escalation
- Immutable audit logging
- RESTful APIs for external integrations
- Webhook system for event notifications
- Legacy system integration support

## Technology Stack

- Node.js (v20+)
- Express.js
- PostgreSQL
- Redis (for job queue)
- JWT for authentication

## Project Structure

```
├── src/
│   ├── config/          # Configuration files
│   ├── models/          # Database models
│   ├── routes/          # Express route handlers
│   ├── controllers/     # Business logic controllers
│   ├── services/        # Service layer
│   ├── middleware/      # Custom middleware
│   ├── utils/           # Utility functions
│   ├── jobs/            # Background job processors
│   ├── app.js           # Express app setup
│   └── server.js        # Server entry point
├── prisma/              # Prisma schema and migrations
├── tests/               # Test files
└── package.json
```

## Getting Started

### Prerequisites

- Node.js v20 or higher
- PostgreSQL 12 or higher
- Redis (for background jobs)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Update `.env` with your database and configuration settings

4. Run database migrations:
```bash
npm run migrate
```

5. Start the development server:
```bash
npm run dev
```

## Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with watch mode
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors
- `npm run format` - Format code with Prettier
- `npm run migrate` - Create and apply new migration
- `npm run migrate:deploy` - Deploy migrations (production)
- `npm run migrate:status` - Check migration status
- `npm run studio` - Open Prisma Studio (database GUI)
- `npm run prisma:generate` - Generate Prisma Client

## API Documentation

API documentation will be available at `/api-docs` once Swagger is configured.

## License

ISC

