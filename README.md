# Sinapsi MVP – Backend & Frontend

This repository houses the serverless backend (AWS–first) and the React/Vite frontend for the Sinapsi MVP. Together they provide secure admin tooling, student chat access, and account management backed by Cognito, DynamoDB, Secrets Manager, and S3.

---

## 1. Backend (Serverless Framework)

### Prerequisites
- Node.js 20+
- AWS CLI configured for the target account
- Serverless Framework (`npm install -g serverless`) or use `npx`

### Install & Deploy
```bash
npm install
npx serverless deploy --stage dev --region eu-south-1
```

Set `USAGE_ALERT_EMAIL` beforehand to wire the SNS alert subscription:
```bash
export USAGE_ALERT_EMAIL=alerts@example.com
```

Common environment overrides:
```bash
export DEFAULT_OPENAI_MONTHLY_TOKENS=200000
export DEFAULT_OPENAI_MONTHLY_SPEND_GBP=50
export DEFAULT_USER_TEMP_PASSWORD=Student1234!
export ADMIN_TEMP_PASSWORD=ChangeMe123!
export ADMIN_USER_EMAIL=admin@ice.cam.ac.uk
export ADMIN_USER_DISPLAY_NAME="ICE Campus Admin"
export ADMIN_USER_ID=admin
export AVATAR_BUCKET=sinapsi-avatars-dev
```

### Key Paths
- `serverless.yml` – infrastructure, Lambda wiring, S3/DynamoDB resources
- `src/handlers` – Lambda entrypoints (`admin`, `account`, `chat`, `personas`, `prompts`, `websocket`)
- `src/repositories`, `src/services`, `src/lib` – data access, orchestration, shared utilities
- `docs/` – MVP spec, Dynamo schema reference, worklog

### Account & Admin Endpoints
- `POST /admin/users` – create users (role, names, avatar key, temp password)
- `GET /admin/users` – list users with pagination/search
- `PUT /admin/users/{userId}` – edit role/profile/avatar metadata
- `DELETE /admin/users/{userId}` – remove from Cognito + Dynamo quotas
- `GET /account/profile` – fetch current user profile
- `PUT /account/profile` – update name metadata
- `POST /account/avatar` – issue presigned S3 URL for avatar uploads

Core chat proxy and quota enforcement are in place; persona storage and detailed usage analytics still have TODOs.

### Provisioning Flow
1. **Seeded admin** – deployment bootstraps a Cognito user pool/client, admin group, and initial admin user. Temporary password defaults to `ChangeMe123!`.
2. **Invite users** – call `/admin/users` (curl example below) to add students or additional admins.
3. **Provider keys** – call `/admin/providers` to store OpenAI credentials in Secrets Manager.

```bash
curl -X POST "$API_BASE/admin/users" \
  -H "Authorization: Bearer <admin-id-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student1@ice.cam.ac.uk",
    "displayName": "Student One",
    "role": "student"
  }'
```

---

## 2. Frontend (Vite + React + shadcn/ui)

### Setup
```bash
cd frontend
cp .env.example .env.local   # fill in pool IDs, API base URL, avatar bucket
npm install
npm run dev                  # app served at http://localhost:5173
```

`.env.example` documents the required values:
- `VITE_AWS_REGION`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_USER_POOL_CLIENT_ID`
- `VITE_API_BASE_URL`
- `VITE_AVATAR_BUCKET`

### Features
- **Token console** – default view post-login with ID token copy helper and quick admin/account links.
- **Account settings (`/account`)** – update display/first/last name and upload cropped circular avatar (S3 presigned upload).
- **Admin dashboard (`/admin`)** – collapsible sidebar, user table with search, invite/edit/delete flows, role selector, temporary password feedback.
- **Mobile-first shell** – gradient header with theme toggle, account dropdown, responsive hamburger navigation.

The frontend reuses Amplify Auth for Cognito, shadcn/ui for polished components, React Router for routing, and Tailwind for styling.

---

## 3. Useful Commands

Backend:
```bash
npm run lint
npm run typecheck
npx serverless deploy --stage <stage> --region <region>
npx serverless remove --stage <stage> --region <region>
```

Frontend:
```bash
cd frontend
npm run lint
npm run build
npm run dev
npm run preview
```

---

## 4. Next Steps
1. Map Cognito subjects to DynamoDB conversations and enforce per-role access within chat/usage handlers.
2. Persist and surface chat transcripts + usage metrics, enforcing quotas in real time.
3. Add streaming responses (WebSocket) and additional model providers (Anthropic, Gemini).
4. Expand observability: structured logging, tracing, alerting, MFA for admin accounts.

Keep running `npm run typecheck` / `npm run lint` before pushing or deploying. This README now covers both halves of the stack—refer to `docs/next.md` for the upcoming work items.
