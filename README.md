# Daily Verse on WhatsApp

People enter their name and number on a React page, choose **Bible** or **Bhagavad Gita** verses,
get a personal welcome message right away, and then one verse every day (from the first day) on WhatsApp from
**+91 89717 75506**. It's all free, self-hosted software: NestJS + Prisma +
MySQL, with no per-message API costs.

> **New here? Follow [GETTING_STARTED.md](GETTING_STARTED.md)** for step-by-step setup on a Mac.

```
 React (Vite) ──► NestJS API ──► MySQL ◄── cron: enqueue daily deliveries (idempotent, batched)
                                   ▲
                                   └── sender (1 per WhatsApp number, DB-lease elected)
                                         worker: claim (SKIP LOCKED) → pace → send → record
                                         Baileys WebSocket = "linked device" of +91 89717 75506
```

---

## 1. Choosing a free sending method

| Option | Cost | Sends from your number | Infra | Ban / ToS risk | Notes |
|---|---|---|---|---|---|
| **WhatsApp Cloud API** (official) | Paid per template message outside the 24h window; daily broadcasts are paid "marketing/utility" templates | Only if you move the number to WhatsApp Business Platform (it then can't be used in the normal app) | None | None | Not free at scale. Rejected by the cost constraint |
| **Twilio WhatsApp** | Twilio fee + Meta fee per message | Same as above | None | None | Not free |
| **whatsapp-web.js** (unofficial) | Free | Yes (linked device) | Headless **Chromium** per session (~300–500 MB RAM) | Violates WhatsApp ToS. Ban possible | Heavy. Breaks when WhatsApp Web's UI/JS changes |
| **Baileys** (unofficial) ✅ | Free | Yes (linked device) | Plain **WebSocket**, no browser (~80–150 MB RAM) | Violates WhatsApp ToS. Ban possible | Light enough for free VMs. Session can live in MySQL. Active maintenance |

**Recommendation: Baileys.** It is the only free option that sends from your personal number
without a browser, so it fits free hosting. The cost is real ToS and ban risk; see §9.
It is implemented behind `MessagingProvider`
([`backend/src/messaging/messaging.types.ts`](backend/src/messaging/messaging.types.ts)).
Business logic only calls `OutboundService` and never imports Baileys. Moving to the Cloud API later
means writing a `CloudApiProvider`, adding a case to the factory in
[`messaging.module.ts`](backend/src/messaging/messaging.module.ts), and setting `MESSAGING_PROVIDER`.
A `console` provider logs messages instead of sending them, for development.

### Ban-risk reductions built in

- **Opt-in mode.** By default (`OPT_IN_MODE=direct`) a subscriber is active as soon as they submit
  the form, and the welcome message goes out immediately. That's the simplest flow, but it messages
  people who never wrote to you, which WhatsApp's spam systems watch for, and anyone can type
  someone else's number. `OPT_IN_MODE=whatsapp_confirm` adds a step where the user sends
  `JOIN <code>` to your number first: lower ban risk, and it proves they own the number.
- **Slow, jittered pacing:** 6 messages/min by default, ±30% random spacing, a "typing…" indicator,
  a hard `DAILY_SEND_CAP` (400) and a send window (07:00–21:30 IST).
- **Different text per person:** each subscriber starts at a random point in the rotation, so
  you never send thousands of identical messages.
- **Respects WhatsApp's own signals:** if WhatsApp puts the account in a "reach-out timelock"
  (temporary messaging restriction), sending pauses automatically. The new-chat message quota is logged.
- **Easy opt-out:** "Reply STOP" in every message, STOP/START keywords, and a web unsubscribe link.
- **Leaves your normal chats alone:** only `JOIN <code>`, `STOP` (from subscribers) and `START` (from
  unsubscribed users) are handled. Every other message to your personal number is ignored.
- `markOnlineOnConnect: false`, so your phone keeps getting notifications.

---

## 2. Verse content (free, bundled, no runtime API)

| Type | Text | License | File |
|---|---|---|---|
| Bible | King James Version (1769), all 31,102 verses | Public domain | `backend/prisma/data/bible-kjv.json.gz` |
| Bhagavad Gita | All 701 verses: Sanskrit + IAST transliteration + English by **Shri Purohit Swami** (1935) | Sanskrit/transliteration: public domain. Purohit Swami died in 1941, so the translation is public domain in India (life + 60 years). Compilation: Unlicense ([gita/gita](https://github.com/gita/gita)) | `backend/prisma/data/gita.json.gz` |

The datasets (1.5 MB gzipped) ship in the repo and load during the seed. Nothing is fetched at
runtime, so nothing can rate-limit you or disappear. `npm run datasets:build` regenerates them from
the sources listed in [`scripts/build-datasets.mjs`](backend/scripts/build-datasets.mjs).
If you serve users outside India, check the Purohit Swami translation's status in their
jurisdictions. Swapping in another public-domain translation means changing one constant in that script.

### How each day's verse is chosen

1. The seed orders verses into two tiers, each a fixed, seeded shuffle:

   | | Tier 1 (sent first) | Tier 2 (after tier 1 is used up) | Total |
   |---|---|---|---|
   | **Bible** | 420 well-known verses from [`bible-daily-refs.txt`](backend/prisma/data/bible-daily-refs.txt) | 10,471 more verses that read well on their own (full sentences; no genealogies or mid-story fragments) | 10,891 ≈ **29.8 years** |
   | **Gita** | 654 verses, chapters 2–18 | 47 verses of chapter 1 | all 701 ≈ **1.9 years** |

2. Each subscriber starts at a random point in each tier (`rotationOffset`) and walks forward, so
   different people get different verses on the same day.
3. **No verse is ever repeated for a subscriber.** Every verse handed to someone is recorded in
   `subscriber_verses` with `PRIMARY KEY (subscriberId, verseId)`. Selection skips recorded verses,
   and the record is written atomically *before* sending, so the database itself refuses a repeat:
   - retries of a failed send reuse the same delivery and the same verse (it's one message, not two);
   - after a crash mid-send the verse stays recorded, so it is skipped rather than sent again;
   - switching between Bible and Gita, or unsubscribing and resubscribing, keeps the history;
   - the history is never purged (unlike delivery rows).
   If a send fails permanently, the verse is released, so it can still be delivered on a later day.
4. When a subscriber has received **every** verse of their type, they stop receiving verses
   (`ON_VERSES_EXHAUSTED=stop`, the default) rather than seeing a repeat. For the Gita that is after
   about 23 months. Set `ON_VERSES_EXHAUSTED=restart` to begin a new cycle instead.
5. Check it yourself: `npm run verify:no-repeats` simulates every day for a test subscriber
   until the pool is empty and checks for duplicates. The admin page also shows
   **Repeated verses: 0**, an audit across all deliveries.

---

## 3. Scaling design

| Concern | Mechanism |
|---|---|
| Cron must not send inline | The cron only **enqueues** rows in `deliveries`. A separate worker sends them |
| Large subscriber counts | Keyset pagination over `subscribers (status, id)` with `createMany` batches of 1,000. **50,000 subscribers enqueue in ~3 s** (measured on MariaDB) |
| Queue without Redis | MySQL table with `SELECT … FOR UPDATE SKIP LOCKED`. Free Redis tiers (e.g. Upstash) cap commands per month, and BullMQ's polling burns through that quota. That would be the step that forces a paid upgrade, so it's avoided |
| No duplicates | `UNIQUE(subscriberId, deliveryDate, kind)` (at most one welcome and one daily verse per person per day) makes enqueue idempotent (cron re-runs, catch-up after downtime, several replicas). Rows go `PROCESSING → SENDING → SENT`. If a process dies **during** a send, the row becomes `UNKNOWN` and is **never retried**: a rare missed day rather than a duplicate |
| Retries | Transient errors → `PENDING` with exponential backoff and jitter (30 s → 1 h), up to `MAX_DELIVERY_ATTEMPTS`. Permanent errors (number not on WhatsApp) → `FAILED` |
| Crash recovery | Claims carry `lockedBy/lockedUntil`. A reaper re-queues abandoned claims every minute, and graceful shutdown hands claims back immediately |
| Missed cron | The daily job checks every minute ("is it past the send time and not done today?"), so a restart at 07:00 doesn't skip a day |
| Indexes | `deliveries(status, nextAttemptAt)` for claims (verified with `EXPLAIN`: range + covering index), `(status, lockedUntil)` for the reaper, `(deliveryDate, status)` for expiry/stats, `subscribers(status, id)` for enqueue, unique `phoneE164`, `confirmCode`, `manageToken`, `verses(type, rotationIndex)` |
| Storage on a free DB | Delivery rows older than `DELIVERY_RETENTION_DAYS` (30) are purged nightly in chunks |

### Horizontal scaling

- **API replicas** (`PROCESS_ROLE=api`) are stateless: run as many as you like behind a load balancer.
- **Scheduler:** every replica may run the cron, but a DB lease (`leases` table) lets only one
  work per tick. Correctness doesn't depend on that, since enqueue is idempotent.
- **Sender** (`PROCESS_ROLE=sender` or `all`): a WhatsApp linked device allows **one** live
  connection, so one process per number holds the `whatsapp-sender:<session>` lease (renewed
  every 10 s, TTL 30 s). Extra sender replicas are hot standbys and take over within ~30 s (tested:
  ~5 s on graceful shutdown).
- **The honest ceiling is WhatsApp, not the infrastructure.** One personal number can safely send a
  few hundred messages a day; the default cap is 400. Queue, DB and API handle far more (tested with
  50k). Past the cap, deliveries roll over and expire at midnight, and the `/admin` page shows this.
  The only way to raise real throughput is more numbers (one `WA_SESSION_ID` and sender per number,
  with subscribers sharded across them) or the paid Cloud API. Both are pluggable without touching
  business logic.

---

## 4. Project layout

```
verse-whatsapp/
├── docker-compose.yml            # mysql + backend + frontend (nginx) on one host
├── .env.example                  # compose secrets
├── backend/
│   ├── Dockerfile, docker-entrypoint.sh (migrate → seed → start)
│   ├── .env.example              # every backend variable, documented
│   ├── .env.docker               # non-secret production defaults for compose
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/20261118000000_init/migration.sql
│   │   ├── seed.ts               # idempotent, ~3 s, no network
│   │   └── data/                 # bible-kjv.json.gz, gita.json.gz, bible-daily-refs.txt
│   ├── scripts/build-datasets.mjs
│   └── src/
│       ├── main.ts, app.module.ts
│       ├── config/               # env validation (fails fast), typed AppConfigService
│       ├── common/               # exception filter, admin guard, phone + time utils (+ specs)
│       ├── prisma/               # PrismaService
│       ├── coordination/         # DB leases (leader election)
│       ├── messaging/            # MessagingProvider, Baileys + console providers,
│       │                         # MySQL auth state, OutboundService (pacing/cap), sender leadership
│       ├── verses/               # rotation + message formatting (+ spec)
│       ├── delivery/             # queue repository, cron scheduler, worker, backoff (+ spec)
│       ├── subscribers/          # REST API, service, repository, DTOs, WhatsApp keyword commands
│       ├── admin/                # QR / pairing code / stats endpoints
│       └── health/
└── frontend/
    ├── Dockerfile, nginx.conf, .env.example, public/_redirects
    └── src/ App.tsx, api.ts, pages/{Subscribe,Manage,Admin}Page.tsx, components/QrImage.tsx, styles.css
```

Layering: controller → service → repository → Prisma. Global `ValidationPipe` (whitelist +
forbid unknown fields), one JSON error shape (`AllExceptionsFilter`), helmet, CORS allow-list,
per-IP rate limits (5 sign-ups/min), structured JSON logs (`LOG_JSON=true`), and phone numbers
masked in logs and API responses.

---

## 5. Run locally

Requirements: **Node ≥ 22.12** (Baileys is ESM-only and is loaded via `require(esm)`), and MySQL 8.0+ (or MariaDB 10.6+).

```bash
docker run -d --name verses-mysql -p 3306:3306 -e MYSQL_DATABASE=verses -e MYSQL_USER=verses -e MYSQL_PASSWORD=verses -e MYSQL_ROOT_PASSWORD=root mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

```bash
cd verse-whatsapp/backend
cp .env.example .env          # for a dry run set MESSAGING_PROVIDER=console
npm install
npx prisma migrate deploy     # or: npm run prisma:migrate:dev while changing the schema
npm run prisma:seed
npm run start:dev             # API on http://localhost:3000/api
```

```bash
cd verse-whatsapp/frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :3000)
```

With `MESSAGING_PROVIDER=console` you can simulate the user's WhatsApp reply:

```bash
curl -X POST localhost:3000/api/admin/dev/simulate-inbound -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' -d '{"phone":"9876543210","text":"JOIN ABC123"}'
```

Tests: `cd backend && npm test`.

### API

| Method & path | Purpose |
|---|---|
| `GET /api/subscribers/options` | Verse types, opt-in mode, send time |
| `POST /api/subscribers` `{phone, verseType: "BIBLE"\|"GITA"}` | Register. Returns the masked number, `manageToken` and, if pending, `confirmation {code, whatsappUrl, expiresAt}`. `409` if already active |
| `GET /api/subscribers/manage/:token` | Status (polled by the UI while waiting for `JOIN`) |
| `POST /api/subscribers/manage/:token/unsubscribe` | Opt out |
| `GET /api/health` | DB + WhatsApp state |
| `GET /api/admin/whatsapp` · `POST …/pairing-code` · `POST …/logout` | Linking (header `x-admin-key`) |
| `GET /api/admin/stats` · `POST /api/admin/jobs/enqueue-today` | Operations |

---

## 6. Link +91 89717 75506 (one time)

1. Start the backend with `MESSAGING_PROVIDER=baileys` and open **`/admin`** in the web app
   (enter `ADMIN_API_KEY`).
2. On the phone with +91 89717 75506: **WhatsApp → Settings → Linked devices → Link a device**,
   then scan the QR code (it refreshes every ~20 s).
   No camera access (e.g. on a server)? Click **Get pairing code** and choose *Link with phone number
   instead* on the phone.
3. Status changes to `open`. If the linked account isn't `WA_PHONE_NUMBER`, the server refuses to send.

**Session persistence:** credentials and Signal keys go into the `whatsapp_auth` table, not
local files. Restarts, redeploys and failover to another replica resume the same linked device
with no re-scan. You must re-link only if you remove the device from your phone, or if the phone
stays offline long enough for WhatsApp to drop linked devices (~14 days). The admin page then shows
a new QR. Keep the phone on, with WhatsApp installed and online now and then.

---

## 7. Deploy for free

The sender needs an **always-on process holding a WebSocket**. Free tiers that sleep or are
serverless (Render free, Vercel/Netlify functions, Cloud Run scale-to-zero) can't run it: the
socket drops and the cron never fires. The reliable zero-cost option is a free VM.

### Recommended: everything on an Oracle Cloud "Always Free" VM

The Ampere A1 VM (arm64, up to 4 OCPU / 24 GB RAM, 200 GB disk, 10 TB/month egress) easily runs
MySQL, the backend and nginx. All images used are multi-arch, and Baileys' crypto bridge is
WebAssembly, so arm64 works.

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
```

```bash
git clone <your-repo> && cd <your-repo>/verse-whatsapp
cp .env.example .env    # set passwords, ADMIN_API_KEY (openssl rand -hex 24), PUBLIC_WEB_URL
sudo docker compose up -d --build
sudo docker compose logs -f backend
```

The entrypoint applies migrations and seeds automatically. Open port 8080 (or 80) in the VCN
security list and in the VM firewall, then link WhatsApp at `/admin`.

**Free HTTPS:** point a free subdomain (e.g. DuckDNS) at the VM and put Caddy in front
(automatic Let's Encrypt). If you own a domain on Cloudflare, a Cloudflare Tunnel works too and
needs no open ports.

### Alternative split (only the backend must stay on the VM)

- **Frontend:** Cloudflare Pages / Netlify / Vercel static hosting (free). Build `frontend/` with
  `VITE_API_URL=https://your-api-host`. `public/_redirects` handles `/manage` and `/admin`.
  Add that origin to `CORS_ORIGINS`.
- **Database:** a managed free MySQL such as Aiven's free plan (small storage; check current limits).
  It must be real MySQL 8 or MariaDB ≥ 10.6. **TiDB Serverless is not suitable**: the queue needs
  `SKIP LOCKED`. Keeping MySQL on the same VM avoids network latency and a separate free-tier quota.

### Multiple replicas (optional)

Run any number of `PROCESS_ROLE=api` containers with `SKIP_DB_SETUP=true`, plus one or two with
`PROCESS_ROLE=sender`. Leases elect exactly one active sender.

---

## 8. Configuration knobs worth knowing

All variables are documented in [`backend/.env.example`](backend/.env.example) and validated at boot.
The ones that matter most:
`MESSAGES_PER_MINUTE` (6), `DAILY_SEND_CAP` (400), `DAILY_SEND_TIME` (07:00),
`SEND_WINDOW_START/END`, `APP_TIMEZONE` (Asia/Kolkata), `OPT_IN_MODE`, `PROCESS_ROLE`,
`DELIVERY_RETENTION_DAYS`.

---

## 9. Limitations and risks — read before going live

1. **Account ban risk is real.** Baileys automates WhatsApp Web, which breaks WhatsApp's Terms of
   Service. WhatsApp can restrict or permanently ban **+91 89717 75506**, your personal number with
   all its chats, at any time and without appeal. Bulk messaging, many reports or blocks, and
   messages to people who never wrote to you are the main triggers. The safeguards above lower the
   risk but cannot remove it. **Back up your chats**, and consider a dedicated secondary number.
2. **Throughput ceiling.** Plan for a few hundred messages a day from one number. Raising
   `DAILY_SEND_CAP` or `MESSAGES_PER_MINUTE` raises ban risk faster than it raises reach. Beyond that you need
   more numbers or the paid official API.
3. **Unofficial protocol churn.** WhatsApp changes its protocol without notice. Baileys is pinned
   (`7.0.0-rc14`, a release candidate, because it is the actively maintained line). Expect to update it
   occasionally, and watch the logs or `/api/health` for disconnects.
4. **Linked-device dependence.** The phone must keep WhatsApp installed and come online
   periodically, or the linked session expires and you must scan again.
5. **Delivery semantics.** At-most-once per day: a crash in the middle of a send yields one missed
   day (`UNKNOWN`), never a duplicate. Deliveries not sent by midnight (cap reached, downtime)
   expire, and the subscriber simply gets the next verse the next day.
6. **Privacy-addressed users (LIDs).** If WhatsApp hides a sender's phone number, the confirmation is
   matched by code alone, and verses go to the WhatsApp account that sent `JOIN`. That is correct,
   but the stored number then isn't independently verified.
7. **Free-tier caveats.** Oracle needs a card for identity verification (Always Free isn't charged),
   A1 capacity is sometimes unavailable in popular regions, and Oracle may reclaim Always Free VMs
   it considers idle (very low CPU, network and memory over 7 days). This app's constant socket and
   cron usually count as activity, but keep an eye on it. Managed free databases have small storage
   and connection limits; the retention purge keeps this app small (~300 bytes per delivery row).
8. **Translation licensing.** KJV is public domain (the UK's Crown patent aside). The Gita English
   text is public domain in India but may still be copyrighted elsewhere. See §2.
9. **Rate limiting is per replica (in memory).** That's enough for one or a few instances. Behind
   many replicas, rely on the reverse proxy or Cloudflare to limit the sign-up endpoint.
