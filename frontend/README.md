# Sinapsi Frontend (MVP)

Minimal React + Vite app that lets admins/students authenticate against the Cognito user pool and grab their ID token for API calls.

## Setup

1. Copy the example env file and fill in your values (pool, client, API URL):

   ```bash
   cp .env.example .env.local
   ```

   Populate:

   - `VITE_AWS_REGION` – e.g. `eu-south-1`
   - `VITE_COGNITO_USER_POOL_ID` – from the deployed stack
   - `VITE_COGNITO_USER_POOL_CLIENT_ID` – from the deployed stack
   - `VITE_API_BASE_URL` – API Gateway base URL (optional, used for hints)

2. Install dependencies (run once):

   ```bash
   npm install
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

   Vite prints the localhost URL (default `http://localhost:5173`). The mobile-first login screen renders immediately; once authenticated you land on the shell with the new top navigation.

## Usage

1. Sign in with either the seeded admin or a student account.
2. If Cognito requires a password change, you’ll be prompted to set the new password.
3. After signing in, the “Token Console” appears with the Sinapsi header, theme toggle, and an ID token copy button. Admins see an “Admin” link that navigates to `/admin`.
4. The admin dashboard includes a collapsible sidebar and exposes the *Users* table where you can search, paginate, invite, edit, and delete users. Role selection (admin vs student) is available when inviting/editing.
5. Mobile users access navigation via the hamburger menu; light/dark modes remain available across all views.

> This interface intentionally stays simple while we flesh out the broader UI. Expand it with API calls and post-login views as the application grows.
