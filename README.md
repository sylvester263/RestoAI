# RestoAI — Restaurant AI SaaS Platform

> AI-native, WhatsApp-first restaurant operations platform built for the **Alibaba Cloud AI Hackathon Pakistan 2026** (Alkhidmat Foundation / Bano Qabil).

## What it does

An AI-powered multi-tenant SaaS where a restaurant owner onboards in minutes and gets:

- **WhatsApp AI Order Agent** — Takes orders over WhatsApp in Urdu, English, or Roman Urdu, powered by Qwen
- **Menu Management** — Full CRUD with Urdu names, categories, and availability toggles
- **Menu Photo Digitization** — Snap a photo of a physical menu → structured menu items via Qwen Vision
- **Kitchen Display** — Real-time order queue with one-click status advancement
- **Admin Dashboard** — KPIs, revenue trends, top items, customer analytics
- **AI Insights** — Natural-language Q&A over your order data ("What sold best last week?")
- **Multi-tenant** — Each restaurant isolated by `tenant_id`, ready for SaaS scale

## Tech Stack

| Layer | Tech |
|---|---|
| AI/LLM | Qwen (qwen-plus, qwen-vl-plus) via Alibaba Cloud DashScope |
| Backend | Node.js / Express (ES modules) |
| Database | PostgreSQL |
| Frontend | React 18 + Tailwind CSS + Vite |
| Auth | JWT with role-based access (owner/manager/staff) |
| WhatsApp | Meta WhatsApp Cloud API (with simulation endpoint for dev) |

## Project Structure

```
restaurant-ai-saas/
├── server/                     # Express API backend
│   └── src/
│       ├── index.js            # App entry, middleware, route mounting
│       ├── config.js           # Environment config
│       ├── db/
│       │   ├── pool.js         # PostgreSQL connection pool
│       │   ├── migrate.js      # Database schema migrations
│       │   └── seed.js         # Demo data seeder
│       ├── middleware/
│       │   ├── auth.js         # JWT authentication + RBAC
│       │   └── error-handler.js
│       ├── routes/
│       │   ├── auth.js         # Register / Login
│       │   ├── menu.js         # Menu CRUD + digitization
│       │   ├── orders.js       # Orders + kitchen view
│       │   ├── branches.js     # Branch management
│       │   ├── insights.js     # Dashboard KPIs + AI Q&A
│       │   └── whatsapp.js     # Webhook + simulation
│       └── services/
│           ├── ai-agent.js     # Qwen: order parsing, vision, insights
│           └── whatsapp.js     # WhatsApp message orchestration
├── client/                     # React frontend
│   └── src/
│       ├── App.jsx             # Router
│       ├── lib/api.js          # API client
│       ├── contexts/           # Auth context
│       ├── components/         # Layout, shared UI
│       └── pages/
│           ├── Login.jsx
│           ├── Dashboard.jsx
│           ├── Menu.jsx
│           ├── Orders.jsx
│           ├── Kitchen.jsx     # Full-screen kitchen display
│           ├── Insights.jsx    # AI Q&A interface
│           └── WhatsAppDemo.jsx
├── .env.example
├── package.json                # Monorepo root (npm workspaces)
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or Supabase local)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your database URL, DashScope API key, etc.
```

### 3. Set up database

```bash
# Run migrations (creates all tables)
npm run db:migrate

# Seed demo data (Lahore Karahi House restaurant with sample orders)
npm run db:seed
```

### 4. Start development servers

```bash
# Starts both backend (port 4000) and frontend (port 3000)
npm run dev
```

### 5. Demo login

- **Email:** `ahmed@karahi.pk`
- **Password:** `demo1234`

## API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Onboard new restaurant + owner |
| POST | `/api/auth/login` | No | Get JWT token |
| GET | `/api/menu` | Yes | List menu items |
| POST | `/api/menu` | Yes | Create menu item |
| POST | `/api/menu/digitize` | Yes | Photo → menu items (Qwen Vision) |
| GET | `/api/orders` | Yes | List orders (with filters) |
| GET | `/api/orders/kitchen` | Yes | Active kitchen orders |
| PATCH | `/api/orders/:id/status` | Yes | Update order status |
| GET | `/api/insights/dashboard` | Yes | Pre-computed KPIs |
| POST | `/api/insights/query` | Yes | Natural-language Q&A |
| GET | `/api/whatsapp/webhook` | No | Meta webhook verification |
| POST | `/api/whatsapp/webhook` | No | Incoming WhatsApp messages |
| POST | `/api/whatsapp/simulate` | No | Dev-only message simulation |

## Architecture Decisions

1. **Separation of concerns** — WhatsApp gateway, AI agent, and business logic are decoupled services
2. **Multi-tenancy by design** — Every entity scoped to `tenant_id` from day one
3. **Prompt versioning** — Qwen prompts are versioned constants, not inline strings
4. **Graceful degradation** — AI parse failures fall back to a safe response, never crash the order
5. **API-first** — Same REST API serves admin dashboard, kitchen display, and future mobile app
6. **Statelessness** — Conversation state persisted in DB, not in memory

## Demo Flow (for Hackathon Presentation)

1. **Onboard** → Register a new restaurant or login with demo credentials
2. **Dashboard** → See live KPIs, revenue trends, top items
3. **WhatsApp Demo** → Send a Roman Urdu order message → watch AI parse it → order appears
4. **Kitchen Display** → See the order on kitchen screen → advance to "ready"
5. **Insights** → Ask "What was my best-selling item this week?" → get AI-generated answer
6. **Menu** → Show full menu CRUD with Urdu names and availability

## Roadmap (V2 — Post-Hackathon)

- Marketing content generator (Qwen writes promotional messages)
- Multi-branch / franchise mode
- Voice ordering (Qwen audio)
- Payment integration (JazzCash / EasyPaisa)
- Customer loyalty / CRM module
- Deploy on Alibaba Cloud infrastructure

## License

MIT — Built for the Alibaba Cloud AI Hackathon Pakistan 2026.
