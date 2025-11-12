# Texting App

A real-time messaging application built with **Node.js + Express**, **WebSocket**, and **MySQL**.

## Features

- Private direct messages between users
- Group chat functionality
- Real-time typing indicators (WebSocket)
- Message editing and deletion
- User authentication with bcrypt
- Profile pictures

## Quick Start (Local Development)

### Prerequisites

- Node.js 14+
- MySQL 5.7+ or compatible database (e.g., Aiven)
- Git

### Setup

1. Clone the repository:
   ```bash
   git clone <your-repo>
   cd texting
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file (use `.env.example` as a template):
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` with your database credentials:
   ```
   DB_HOST=your-db-host
   DB_USER=your-db-user
   DB_PASSWORD=your-db-password
   DB_NAME=texting
   DB_PORT=3306
   DB_SSL=REQUIRED
   SESSION_SECRET=your-long-random-secret-here
   ```

4. Run database migrations:
   ```bash
   npm run migrate
   ```
   This creates the `texting` database and all required tables.

5. Start the server:
   ```bash
   npm start
   ```
   The server will run on `http://localhost:3000`

   For development with auto-restart:
   ```bash
   npm run dev
   ```

## Deployment

### Deploy to Render

See **[RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md)** for complete step-by-step instructions.

Quick summary:
1. Push your code to GitHub
2. Connect your repository to Render
3. Configure environment variables in Render dashboard
4. Render will automatically run `npm run migrate` before starting the server

### Environment Variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `DB_HOST` | Yes | `db.example.com` | Database host |
| `DB_USER` | Yes | `admin` | Database user |
| `DB_PASSWORD` | Yes | (secret) | Database password |
| `DB_NAME` | No | `texting` | Database name (default: `texting`) |
| `DB_PORT` | No | `3306` | Database port (default: `undefined`) |
| `DB_SSL` | No | `REQUIRED` | Enable SSL (`REQUIRED` or leave empty) |
| `DB_SSL_CA_PATH` | No | `/path/to/ca.pem` | Path to CA certificate for SSL verification |
| `DB_SSL_INSECURE` | No | `true` | Disable certificate verification (⚠️ insecure, development only) |
| `SESSION_SECRET` | Yes | (random string) | Session encryption key; generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | No | `3000` | Server port (Render assigns automatically) |
| `NODE_ENV` | No | `production` | Environment mode |

## Project Structure

```
.
├── app.js                    # Main Express server
├── migrations/
│   └── init.sql             # Database schema
├── scripts/
│   └── run_migrations.js    # Migration runner
├── public/
│   ├── index.html
│   ├── login.html
│   ├── signup.html
│   └── style.css
├── package.json
├── render.yaml              # Render deployment config
├── .env.example             # Environment variables template
└── README.md                # This file
```

## Database Schema

The app uses 6 tables:
- `users` — User accounts
- `conversations` — 1-on-1 direct message chats
- `direct_messages` — Messages in conversations
- `group_chats` — Group chat metadata
- `group_members` — Group membership
- `group_messages` — Messages in groups

See `migrations/init.sql` for full schema.

## Scripts

```bash
npm start              # Start production server
npm run dev          # Start with auto-restart (nodemon)
npm run migrate      # Run database migrations
npm test             # Run tests (not yet implemented)
```

## Troubleshooting

### "Database connection failed"
- Check that `DB_HOST`, `DB_USER`, `DB_PASSWORD` are correct
- Ensure your database is running and accessible
- For SSL errors, try `DB_SSL_INSECURE=true` (local testing only)

### "Cannot read properties of undefined (reading 'userId')"
- This means session middleware isn't initialized; shouldn't happen with the fixed `app.js`
- Restart the server

### Migration fails
- Ensure the database user has `CREATE DATABASE` and `CREATE TABLE` permissions
- Check the migration logs: `npm run migrate`

## Security Notes

⚠️ **Never commit `.env` files with real secrets!**
- Use `.env.example` as a template
- Add `.env` to `.gitignore` (already done)
- Rotate `SESSION_SECRET` regularly in production
- Use strong database passwords

## License

ISC
