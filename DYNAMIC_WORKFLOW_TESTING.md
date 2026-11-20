# Dynamic Workflow Engine: Implementation & Testing Guide

This document outlines everything that was implemented for the Dynamic Workflow Engine in IACMS and provides step-by-step instructions on how to manually test the entire lifecycle from your local machine.

---

## 1. What is Implemented & How?

### Backend (Microservices & DB)
1. **Schema Refactoring (`prisma/schema.prisma`)**:
   - Added `Workflow`, `WorkflowStep`, and `WorkflowTransition` to define dynamic multi-tenant workflows.
   - Migrated the legacy `WorkflowState` to `CaseHistory` to create an immutable audit log of case transitions.
   - Added `CaseSequence` to generate human-readable case IDs (e.g., `DSS-2026-0001`).
2. **API Gateway (`services/api-gateway`)**:
   - Modified the authentication middleware to extract and forward `x-user-roles` downstream. This allows microservices to perform Role-Based Access Control (RBAC).
3. **Workflow Service (`services/workflow-service`)**:
   - Implemented a complete REST API for designing workflows.
   - Supports creating `DRAFT` workflows, adding Steps (with `isInitial`/`isFinal` flags), and Transitions (with role restrictions and comment requirements).
   - The `POST /workflows/:id/publish` endpoint validates the workflow (ensuring exactly 1 initial step) and freezes it to `PUBLISHED` status so it can be used by cases.
4. **Case Service (`services/case-service`)**:
   - `POST /cases`: Binds a new case to a `PUBLISHED` workflow, generates a sequence-based case number, and sets the case to the workflow's initial step.
   - `POST /cases/:id/transitions/:transitionId/execute`: The core execution engine. It verifies if the transition is valid from the current step, checks if the user's role allows it, moves the case to the new step, logs a `CaseHistory` record, and emits a Kafka event.
   - `GET /cases/:id/state`: Aggregates the case's current step, calculates `availableActions` based on the user's roles, and returns the case history timeline.

### Frontend (Client-main - React)
1. **Workflow Admin Pages**:
   - **Workflows Page (`/workflows`)**: A dashboard listing all drafts and published workflows.
   - **Workflow Designer (`/workflows/:id/designer`)**: A visual UI to add Steps, link them with Transitions, and Publish the engine.
2. **Case Execution Panel (`/cases/:id`)**:
   - Upgraded the Case Details page to integrate seamlessly with the new engine.
   - Displays the **Current Step** prominently.
   - Dynamically renders **Available Actions** as buttons (e.g., "Approve", "Reject") based on backend RBAC.
   - Features a **Case Timeline** tab that graphically represents the `CaseHistory` audit trail.

---

## 2. How to Test it Manually

Follow these steps in your terminal and browser to spin up the system and test the dynamic engine.

### Step 1: Start Infrastructure & Migrate Database
Open a terminal at the root of the project (`C:\Users\zbook\Desktop\IACMS`):

```bash
# 1. Ensure Docker Desktop is running.
# 2. Start PostgreSQL & Kafka via docker-compose
docker compose -f infrastructure/docker-compose.yml up -d

# 3. Apply the Prisma schema changes to the database
npx prisma migrate dev --name dynamic_workflows

# 4. Generate the JS Prisma Client
npx prisma generate
```

### Step 2: Start the Backend Services
You will need to start your API gateway and microservices. Depending on your setup (e.g., if you use `pm2` or concurrent scripts in `package.json`), run the start command. For example:

```bash
npm run dev
# OR start the gateway, case-service, auth-service, and workflow-service individually
```

### Step 3: Start the Frontend
Open a new terminal window:

```bash
cd Client-main
npm install
npm run dev
```

### Step 4: UI Walkthrough (The Test)

1. **Login**: Open your browser to `http://localhost:5173` and log in to the portal as a tenant user.
2. **Create a Workflow**:
   - Click **Workflows** in the left sidebar.
   - Click the **+ Create Workflow** button. Enter a name (e.g., "Standard Review").
   - You will be redirected to the **Workflow Designer**.
3. **Design the Steps**:
   - Click **Add Step**. Name it `Initial Intake`, mark it as the **Initial** step, and **not** final.
   - Click **Add Step** again. Name it `Approved`, mark it as **not** initial, and **Final**.
4. **Design the Transition**:
   - Click **Add Transition**. 
   - Name it `Approve Case`. 
   - Enter the key for the `Initial Intake` step as the **From Step**.
   - Enter the key for the `Approved` step as the **To Step**.
5. **Publish**:
   - Click the **Publish** button. The workflow is now locked and ready for cases.
6. **Create a Case**:
   - Go to **Cases** in the sidebar.
   - Create a new case. The backend will automatically bind it to your published workflow and assign it a sequence number (e.g., `TENANT-2026-0001`).
7. **Execute an Action**:
   - Click on the newly created case to open the `CaseDetailPage`.
   - On the right-side panel, you will see **WORKFLOW**. 
   - It will display the current step: **Initial Intake**.
   - Below it, you will see your **Available Actions**: an `Approve Case` button.
   - Click the **Approve Case** button. Enter a comment when prompted (e.g., "Looks good!").
8. **View the Audit Trail**:
   - The Current Step will immediately update to **Approved** (Terminal).
   - Click on the **ACTIVITY LOG** tab in the main panel.
   - You will see a beautiful timeline mapping out the case creation and your recent "Approve Case" transition, complete with the timestamp, your name, and your comment.
