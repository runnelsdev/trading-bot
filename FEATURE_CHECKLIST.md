# Trading Bot Feature Checklist

This document consolidates the feature requirements for both the **Bot Server** (individual trading bot instances) and the **Central Server** (management and monitoring).

---

## Bot Server (Individual Instance)

### Core Functionality

| Feature | Status | Implementation |
|---------|--------|----------------|
| Bot process runs reliably on startup | ✅ | PM2 process management on droplets |
| Connects to Tastytrade API | ✅ | `TastytradeExecutor.js` - OAuth + session auth |
| Connects to Discord (posts signals to configured channels) | ✅ | Discord.js integration in bot |
| Handles reconnection gracefully (exchange + Discord) | ✅ | Auto-reconnect logic in both clients |
| Processes trading signals and executes configured actions | ✅ | Signal parsing + order execution |

### Health & Communication

| Feature | Status | Implementation |
|---------|--------|----------------|
| Heartbeat endpoint (returns status, uptime, last signal time) | ✅ | `/health` endpoint on each bot |
| Pushes heartbeat to central service on interval | ✅ | `ConfigClient.startHeartbeat()` - 60s interval |
| Reports own state changes (starting, healthy, error, shutting down) | ✅ | Heartbeat includes metrics + status |
| Graceful shutdown handler (notifies central before terminating) | ✅ | `ConfigClient.stopHeartbeat()` on shutdown |

### Configuration

| Feature | Status | Implementation |
|---------|--------|----------------|
| Reads config from central service on startup | ✅ | `ConfigClient.authenticate()` fetches trading status |
| Accepts config updates without full restart | ⚠️ | Partial - status refreshes, full config requires restart |
| Stores local fallback config in case central is unreachable | ✅ | `.env` file + cached trading status |

### Security

| Feature | Status | Implementation |
|---------|--------|----------------|
| API keys encrypted at rest | ⚠️ | Stored in `.env` files (file system permissions) |
| Authenticated communication with central service | ✅ | JWT tokens via `botToken` + `sessionToken` |
| No sensitive data in logs | ✅ | Credentials masked in log output |

---

## Central Server

### Bot Registry

| Feature | Status | Implementation |
|---------|--------|----------------|
| Register new bot instances | ✅ | `bots` table + deployer service |
| Store bot metadata (instance ID, IP, subscriber, created date) | ✅ | `bots` table columns |
| Track bot state (provisioning → active → destroyed) | ✅ | `bots.status` field with lifecycle states |
| Archive destroyed bots (retain config for redeployment) | ✅ | `archived_bots` table for soft-delete |

### Health Monitoring

| Feature | Status | Implementation |
|---------|--------|----------------|
| Receive heartbeats from bot servers | ✅ | `POST /api/v1/bot/heartbeat` endpoint |
| Mark bots unhealthy after missed heartbeats | ✅ | `OfflineDetectionJob.js` - 5 min threshold |
| Secondary active polling for verification | ✅ | `HealthPollingJob.js` - 10 min HTTP polling |
| Alert subscriber on state changes | ✅ | `AlertService.sendBotStatusAlert()` - Discord DM + webhook |

### Configuration Management

| Feature | Status | Implementation |
|---------|--------|----------------|
| Store bot configs per subscriber | ✅ | `bots` table + subscriber association |
| Serve config to bot servers on request | ✅ | `POST /api/v1/bot/authenticate` returns trading status |
| API for updating config (from dashboard) | ✅ | `POST /api/v1/admin/update-bot-settings` |

### Subscriber Dashboard

| Feature | Status | Implementation |
|---------|--------|----------------|
| List all bots (active, unhealthy, stopped, archived) | ✅ | Admin UI bots table + archived bots endpoint |
| Status indicators with last healthy timestamp | ✅ | Status badge + `last_connected` column |
| Quick actions: view config, restart, destroy, redeploy | ✅ | Action buttons in admin UI |
| Setup wizard for new bots | ⚠️ | Not implemented - manual setup via admin |

### Authentication

| Feature | Status | Implementation |
|---------|--------|----------------|
| Subscriber login (email/password or OAuth) | ✅ | Subscriber portal at `/portal` - Discord ID + account auth |
| Bot server authentication (tokens or certificates) | ✅ | `botToken` + JWT `sessionToken` |
| Secure API endpoints | ✅ | `authenticateBot`, `authenticateAdmin`, `authenticateSubscriber` middleware |

---

## Implementation Files

### Bot Server Files
- `src/TastytradeExecutor.js` - Trade execution + heartbeat integration
- `src/ConfigClient.js` - Central server communication + heartbeat
- `src/PositionSizer.js` - Proportional position sizing
- `src/fill-follower-bot.js` - Main bot entry point

### Central Server Files
- `routes/bot.js` - Bot authentication + heartbeat endpoints
- `routes/admin.js` - Admin API + bot management
- `routes/subscriber.js` - Subscriber self-service portal API
- `services/AlertService.js` - Discord alerts for bot status
- `jobs/OfflineDetectionJob.js` - Passive offline detection
- `jobs/HealthPollingJob.js` - Active health polling
- `jobs/DailyStatusUpdateJob.js` - Nightly tier validation
- `public/admin.html` - Admin dashboard UI
- `public/subscriber.html` - Subscriber portal UI

### Database Tables
- `subscribers` - Subscriber accounts
- `bots` - Active bot instances
- `archived_bots` - Soft-deleted bots
- `tiers` - Subscription tiers
- `trading_status` - Daily trading permissions
- `trade_results` - Trade history
- `health_metrics` - Heartbeat metrics

---

## URLs

| Portal | URL |
|--------|-----|
| Admin Dashboard | https://tradingbot.host/admin |
| Subscriber Portal | https://tradingbot.host/portal |
| Health Check | https://tradingbot.host/health |

---

## Legend

- ✅ Implemented and working
- ⚠️ Partially implemented or needs improvement
- ❌ Not implemented
