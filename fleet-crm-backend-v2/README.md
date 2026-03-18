# 🦅 Super Eagle Fleet CRM — Backend

Full REST API backend for the Fleet CRM.  
Built with Node.js, Express, and SQLite.

---

## What's In Here

```
fleet-crm-backend/
├── server.js              ← Main server (start here)
├── db/
│   └── schema.js          ← Database setup + all tables
├── routes/
│   ├── auth.js            ← Login, users
│   ├── companies.js       ← Company profiles, contacts, calling queue
│   ├── customers.js       ← Customer profiles, calling queue
│   ├── followups.js       ← The unified follow-up queue (companies + customers)
│   ├── visits.js          ← Visit queue (companies only)
│   ├── config.js          ← Follow-up rules, settings
│   ├── dashboard.js       ← Stats + counts for the dashboard
│   └── shared.js          ← Shared utilities (ID generation, date calc, logging)
├── middleware/
│   └── auth.js            ← JWT auth check
├── data/
│   └── fleet_crm.db       ← SQLite database (auto-created on first run)
├── .env.example           ← Copy this to .env
└── package.json
```

---

## First-Time Setup

### Step 1 — Install Node.js
Go to https://nodejs.org and download the **LTS** version. Install it.

### Step 2 — Set up your environment file
In the `fleet-crm-backend` folder, copy `.env.example` to `.env`:
```
cp .env.example .env
```
Open `.env` and change `JWT_SECRET` to any long random string.

### Step 3 — Install dependencies
Open a terminal in the `fleet-crm-backend` folder and run:
```
npm install
```

### Step 4 — Start the server
```
npm run dev
```
You'll see:
```
✅ Default admin user created:
   Email:    admin@supereagle.com
   Password: changeme123

✅ Server running on http://localhost:3001
```

**First thing**: Change the default password after logging in.

---

## Default Login

| Field    | Value                    |
|----------|--------------------------|
| Email    | admin@supereagle.com     |
| Password | changeme123              |

Change this immediately via `POST /api/auth/change-password`.

---

## Key API Endpoints

### Auth
| Method | Path                      | What it does            |
|--------|---------------------------|-------------------------|
| POST   | /api/auth/login           | Log in, get JWT token   |
| GET    | /api/auth/me              | Get your user info      |
| POST   | /api/auth/change-password | Change your password    |
| GET    | /api/auth/users           | List all users          |
| POST   | /api/auth/users           | Add a new user          |

### Companies
| Method | Path                                     | What it does                     |
|--------|------------------------------------------|----------------------------------|
| GET    | /api/companies                           | List all companies               |
| POST   | /api/companies                           | Add a company                    |
| GET    | /api/companies/:id                       | Get company + contacts + stats   |
| PUT    | /api/companies/:id                       | Update company                   |
| GET    | /api/companies/:id/contacts              | List contacts for company        |
| POST   | /api/companies/:id/contacts              | Add a contact                    |
| GET    | /api/companies/:id/history               | Full call history                |
| GET    | /api/companies/queue/list                | Company calling queue            |
| POST   | /api/companies/queue                     | Add company to queue             |
| POST   | /api/companies/queue/:id/complete        | ✅ LOG A CALL                    |
| POST   | /api/companies/import                    | Bulk import from CSV             |

### Customers
| Method | Path                                     | What it does                     |
|--------|------------------------------------------|----------------------------------|
| GET    | /api/customers                           | List all customers               |
| POST   | /api/customers                           | Add a customer                   |
| GET    | /api/customers/:id                       | Get customer + stats             |
| GET    | /api/customers/:id/history               | Full call history                |
| GET    | /api/customers/queue/list                | Customer calling queue           |
| POST   | /api/customers/queue/:id/complete        | ✅ LOG A CALL                    |
| POST   | /api/customers/import                    | Bulk import from CSV             |

### Follow-ups (The Hub)
| Method | Path                          | What it does                             |
|--------|-------------------------------|------------------------------------------|
| GET    | /api/followups                | Due today + overdue (both types)         |
| GET    | /api/followups/all            | All follow-ups including future          |
| PUT    | /api/followups/:id            | Update working notes / lock row          |
| POST   | /api/followups/:id/complete   | ✅ COMPLETE A FOLLOW-UP (routes to right log) |
| POST   | /api/followups/refresh        | Rebuild from call_log                    |

### Visits
| Method | Path                       | What it does                    |
|--------|----------------------------|---------------------------------|
| GET    | /api/visits                | Due visits (today + overdue)    |
| GET    | /api/visits/all            | All scheduled visits            |
| PUT    | /api/visits/:id            | Update notes / reschedule       |
| POST   | /api/visits/:id/complete   | ✅ LOG A VISIT                  |
| DELETE | /api/visits/:id            | Cancel a visit                  |

### Config
| Method | Path                       | What it does                    |
|--------|----------------------------|---------------------------------|
| GET    | /api/config/rules          | All follow-up timing rules      |
| POST   | /api/config/rules          | Add a rule                      |
| PUT    | /api/config/rules/:id      | Update a rule                   |
| GET    | /api/config/settings       | All system settings             |
| PUT    | /api/config/settings/:key  | Update a setting                |
| GET    | /api/config/contact-types  | All contact types (for dropdowns) |

### Dashboard
| Method | Path            | What it does                              |
|--------|-----------------|-------------------------------------------|
| GET    | /api/dashboard  | All stats + counts in one call            |

---

## How Authentication Works

Every request (except login) needs a JWT token in the header:
```
Authorization: Bearer <your-token>
```

The frontend will handle this automatically once built.

---

## The Core Logic (How Completing a Call Works)

1. You're in a calling queue (company or customer)
2. You make the call and fill in: `contact_type`, `next_action`, `notes`
3. Hit complete → the system:
   - Creates a permanent entry in `call_log` (never deleted)
   - If `next_action = Call` → adds to `follow_ups` with calculated date
   - If `next_action = Visit` → adds to `visit_queue` with calculated date
   - If `next_action = Stop` → nothing more (logged but no queue entry)
   - Removes from calling queue

Same flow works from `follow_ups` — it knows whether it's a company or customer.

---

## Database Tables

| Table              | Purpose                                          |
|--------------------|--------------------------------------------------|
| users              | Team members who use the CRM                     |
| companies          | Company profiles (CO-000001 style IDs)           |
| company_contacts   | Multiple contacts per company, one preferred     |
| customers          | Existing shop customers for referral calling     |
| calling_queue      | Active work queue (companies + customers)        |
| call_log           | Permanent history — NEVER deleted or edited      |
| follow_ups         | Due calls queue — both companies + customers     |
| visit_queue        | Due in-person visits — companies only            |
| config_rules       | Contact type → days mapping                      |
| config_settings    | Key/value system settings                        |
| google_sync_log    | Tracks what's been synced to Google Contacts     |

---

## Next Step: The Frontend

The frontend (React) will connect to this API and give you the actual screens to work from. We'll build that next session.
