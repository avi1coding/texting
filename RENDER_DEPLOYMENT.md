# Render Deployment Guide

This guide walks you through deploying the texting app to [Render.com](https://render.com).

## Prerequisites

- A GitHub repository with this project code pushed
- A Render account (free tier available)
- Database credentials from your provider (e.g., Aiven)

## Step 1: Prepare Your Repository

1. Ensure your repository has:
   - `render.yaml` (already included)
   - `.env.example` (already included)
   - `.gitignore` with `.env` (so secrets aren't committed)

2. Never commit your `.env` file with real secrets. Use `.env.example` as a template.

## Step 2: Deploy to Render

### Option A: Via Render Dashboard (Recommended for First-Time Setup)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Fill in the service details:
   - **Name:** `texting-app` (or your choice)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm run migrate && npm start`
   - **Plan:** Free (or Starter)

5. Under **Environment Variables**, add all variables from `.env.example`:
   - `DB_HOST` — your database host (e.g., `avimehta-avimehta.k.aivencloud.com`)
   - `DB_USER` — database user (e.g., `avnadmin`)
   - `DB_PASSWORD` — database password (keep secret!)
   - `DB_NAME` — `texting`
   - `DB_PORT` — `18649`
   - `DB_SSL` — `REQUIRED`
   - `SESSION_SECRET` — a long random string (at least 32 characters)
   - Optional: `DB_SSL_CA_PATH` — if your provider requires a CA certificate

6. Click **"Create Web Service"**
7. Render will build and deploy your app. Logs will show in the dashboard.

### Option B: Via render.yaml (Automatic)

If you push the `render.yaml` file to your repo and connect it to Render, the configuration is applied automatically. You still need to set the environment variables in the dashboard.

## Step 3: Handle the SSL Certificate (if needed)

If your database requires a custom CA certificate (common for managed providers):

1. Download the CA certificate from your provider (e.g., Aiven)
2. In Render dashboard, go to your service → **Environment**
3. Add `DB_SSL_CA_PATH` variable:
   - For Render, you'll need to handle the certificate file differently. See "Certificate Handling" below.

### Certificate Handling (Advanced)

Since Render doesn't have a direct file upload for CA certificates, use one of these approaches:

**Option 1: Inline certificate in environment variable (simple)**
- Encode the CA certificate as base64 or store it in a secret file during build
- Update `scripts/run_migrations.js` and `app.js` to decode if needed

**Option 2: Use a private GitHub repository (recommended)**
- Add the CA certificate file to a private repo
- Update the build script to download it during `npm install` or build phase

**Option 3: Store certificate in Render Secrets**
- Use Render's secret files feature (available on paid plans)

For now, if your provider allows `rejectUnauthorized: false` (insecure, only for testing), set:
```
DB_SSL_INSECURE=true
```

## Step 4: Database Migration

The `render.yaml` specifies:
```yaml
startCommand: npm run migrate && npm start
```

This means:
1. **Before** the server starts, it runs `npm run migrate`
2. The migration creates the `texting` database and all tables
3. Then the server starts normally

**Important:** Make sure your database user has `CREATE DATABASE` permissions. If using a managed service like Aiven with a restricted `defaultdb`, contact support to create the `texting` database or allow it.

## Step 5: Verify Deployment

1. In the Render dashboard, watch the **Logs** tab
2. You should see:
   ```
   > npm run migrate
   Migration successfully applied.
   > npm start
   Server running at http://localhost:3000
   Connected to MySQL database
   ```
3. Once you see "Connected to MySQL database", your app is live!
4. Visit your app URL (e.g., `https://texting-app.onrender.com`)

## Step 6: Troubleshooting

### Build fails with "npm ERR!"
- Check that all dependencies in `package.json` are correct
- Ensure `node_modules` is in `.gitignore`

### Database connection fails
- Verify `DB_HOST`, `DB_USER`, `DB_PASSWORD` in environment variables
- Check that the database host is reachable from Render (usually it is)
- If SSL error: try `DB_SSL=REQUIRED` first, then `DB_SSL_INSECURE=true` for testing

### Migration fails with "Database error"
- Ensure the database user has `CREATE DATABASE` and `CREATE TABLE` permissions
- Check that `DB_NAME=texting` matches the database name you want to create

### "Cannot read properties of undefined (reading 'userId')"
- This is a local development issue; should not occur on Render
- Make sure middleware is properly initialized (it is, in the fixed `app.js`)

## Step 7: Environment Variables Recap

| Variable | Example | Notes |
|---|---|---|
| `DB_HOST` | `avimehta-avimehta.k.aivencloud.com` | Your database host |
| `DB_USER` | `avnadmin` | Database user |
| `DB_PASSWORD` | (keep secret) | Database password |
| `DB_NAME` | `texting` | Database name to create/use |
| `DB_PORT` | `18649` | Database port |
| `DB_SSL` | `REQUIRED` | Enable SSL |
| `DB_SSL_CA_PATH` | (optional) | Path to CA cert (if needed) |
| `SESSION_SECRET` | (random string) | Session encryption key; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NODE_ENV` | `production` | Environment mode |
| `PORT` | (auto by Render) | Not needed; Render assigns |

## Step 8: Useful Commands (Local)

```bash
# Install dependencies
npm install

# Run migrations locally
npm run migrate

# Start the server (production mode)
npm start

# Start with auto-restart (development)
npm run dev
```

## Step 9: Next Steps

- Add a custom domain (Render → Service Settings → Domains)
- Set up monitoring/alerts in Render
- Enable auto-deploys: Render will redeploy on every push to your GitHub branch
- Consider upgrading from Free plan for better uptime guarantees

## Support

For issues with:
- **Render deployment:** https://render.com/docs
- **Database (Aiven):** Your provider's support
- **This app:** Check logs in Render dashboard, or review `README.md`

---

**Good luck! 🚀**
