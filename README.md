# Mapmaker JLS — Netlify + Supabase Rewards Web App

This upgrade keeps the original **Mapmaker JLS** homepage vibe while adding secure login, a digital 15-stamp rewards card, and an admin control room.

## Features added
- Public homepage preserved in fun Mapmaker style.
- User login (`/login`) with Supabase Auth.
- User dashboard (`/dashboard`) with:
  - 15-stamp digital card
  - unlocked vs locked rewards
  - redeemed vs unredeemed status
  - next reward milestone
- Reward rules page (`/rewards`).
- Admin area (`/admin`) for:
  - user creation
  - password reset
  - manual stamp adjustments
  - reward redemption tracking
- Netlify Functions backend with admin checks.

## Reward logic
Milestones:
- 1: BOGO reward
- 5: 25% off map
- 8: 15% off map
- 10: 50% off map
- 12: 75% off map
- 15: BOGO reward

Rules:
- Only qualifying paid purchases should be entered as stamp additions by staff/admin.
- Redeeming free/discount rewards does **not** add a stamp.
- Rewards unlock automatically when the user's stamp count reaches a milestone.
- Redeemed rewards remain visible with redeemed status.

## Tech stack
- Frontend: HTML/CSS/JS
- Hosting: Netlify
- Backend: Netlify Functions
- Auth + DB: Supabase Auth + Supabase Postgres

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `assets/config.js` from `assets/config.example.js` and insert your project URL + anon key.
3. In Supabase SQL editor, run:
   - `db/schema.sql`
4. Create an initial admin account:
   - Sign up one user in Supabase Auth (email format: `yourusername@mapmakerjls.local`)
   - Insert matching profile row with role `admin`

## Required environment variables
Set in Netlify Site settings → Environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Frontend runtime config (`assets/config.js`):
- `supabaseUrl`
- `supabaseAnonKey`

## Netlify deploy
1. Push this repo to GitHub.
2. Connect repo to Netlify.
3. Build settings:
   - Publish directory: `.`
   - Functions directory: `netlify/functions`
4. Add environment variables above.
5. Deploy.

## Functions included
- `admin-create-user`
- `admin-reset-password`
- `admin-adjust-stamps`
- `admin-redeem-reward`

All functions require bearer auth token + admin role verification.

## Expansion notes
- Add multiple stamp cycles by introducing `card_cycle` in `user_stamp_progress`.
- Add staff audit logs in a separate table for compliance.
- Add QR scan check-ins for qualifying purchases.
- Add configurable milestone editor UI that writes to `reward_milestones`.
