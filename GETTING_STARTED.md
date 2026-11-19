# Getting started (macOS)

Step-by-step instructions to run **Daily Verse on WhatsApp** on your Mac.
For the design, free deployment and risks, see [README.md](README.md).

---

## 0. Install the prerequisites (one time)

| Tool | Why | How to check |
|---|---|---|
| **Node.js 22.12 or newer** | Runs the backend and frontend | `node -v` |
| **Docker Desktop** | Runs MySQL locally | `docker -v` |

Install Node.js from https://nodejs.org (the "LTS" version, 22 or newer) or with Homebrew:

```bash
brew install node@22
```

Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and **open it once** so the Docker engine is running (whale icon in the menu bar).

All commands below run in the **Terminal** app, starting from this project folder:

```bash
cd ~/Desktop/verse-whatsapp
```

---

## 1. Start MySQL

```bash
docker run -d --name verses-mysql -p 3307:3306 -e MYSQL_DATABASE=verses -e MYSQL_USER=verses -e MYSQL_PASSWORD=verses -e MYSQL_ROOT_PASSWORD=root mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

Wait about 20 seconds for MySQL to finish starting. (Port **3307** on your Mac avoids clashing with any other MySQL already using 3306.)

> Later, after a reboot: `docker start verses-mysql` (your data is kept).

---

## 2. Configure the backend

```bash
cd backend
cp .env.example .env
npm install
```

Generate an admin key and copy the output:

```bash
openssl rand -hex 24
```

Open `backend/.env` in any editor (for example `open -e .env`) and change (`OPT_IN_MODE=direct` and `BRAND_NAME=U!D Labs` are already set):

```
ADMIN_API_KEY=<paste the key you just generated>
MESSAGING_PROVIDER=console
```

`console` prints messages in the terminal instead of sending them on WhatsApp, so it's safe for a first run.
Set `DATABASE_URL=mysql://verses:verses@localhost:3307/verses` to match step 1.

> Always run `npm run …` commands **inside `backend/`**. Running `npx prisma` elsewhere downloads a newer, incompatible Prisma.

---

## 3. Create the tables and load the verses

```bash
npm run prisma:migrate:deploy
npm run prisma:seed
```

You should see:

```
Bible (KJV): 31102 verses (31102 new), rotation: 420 curated + 10471 extended (0 rotation updates)
Bhagavad Gita: 701 verses (701 new), rotation: 654 (ch. 2–18) + 47 (ch. 1) (0 rotation updates)
Quran: 6236 ayahs (6236 new), rotation: 230 curated + 690 extended (0 rotation updates)
```

The verses are now stored in the MySQL `verses` table. The app reads them from there; the data files are only seed input.

(Re-running the seed is safe: it skips verses that already exist.)

---

## 4. Start the backend

```bash
npm run start:dev
```

Leave this Terminal window open. Check it in the browser: http://localhost:3000/api/health should show `"status":"ok"`.

---

## 5. Start the frontend

Open a **second** Terminal window:

```bash
cd ~/Desktop/verse-whatsapp/frontend
npm install
npm run dev
```

---

## 6. Try it

| Page | URL |
|---|---|
| Sign-up | http://localhost:5173 |
| Manage / unsubscribe | `/manage?token=…` (link on the "Thank you" screen) |
| Admin (WhatsApp link, stats) | http://localhost:5173/admin (enter your `ADMIN_API_KEY`) |
| **API docs (Swagger)** | http://localhost:3000/api/docs: click **Authorize**, paste your `ADMIN_API_KEY` |

1. Enter your **name** and **WhatsApp number**, continue, and pick **Bible**, **Bhagavad Gita** or **Quran**.
2. The page says **"Thank you, <name>!"**. The subscriber is saved right away, and this welcome
   message is sent (printed in the backend terminal in console mode):

   ```
   Hi <name>,

   Thank you for subscribing to U!D Labs. Your first verse will arrive today at 9:30 PM.

   Let's hold hands and begin the path with joy!

   Reply STOP anytime to unsubscribe.
   ```

   The first-verse line depends on when they sign up (`DAILY_SEND_TIME` = 21:30 here):

   | Signed up | Welcome says | First verse |
   |---|---|---|
   | before the send time | "…arrive **today at 9:30 PM**" | in tonight's scheduled run |
   | after the send time, before `SEND_WINDOW_END` | "…arrive **in a few minutes**" | about 30 seconds after the welcome |
   | after `SEND_WINDOW_END` | "…arrive **tomorrow at 9:30 PM**" | tomorrow's run |

   So everyone gets a verse on the day they sign up, unless they sign up after the send window closes.

3. After that, a verse is sent every day at `DAILY_SEND_TIME` (see below).

To send today's verses right away for testing (anyone who already got today's verse is skipped):

```bash
curl -X POST localhost:3000/api/admin/jobs/enqueue-today -H "x-admin-key: YOUR_ADMIN_KEY"
```

### Reports in Swagger

Open http://localhost:3000/api/docs, click **Authorize**, paste `ADMIN_API_KEY`, then use **Try it out**:

| Question | Endpoint |
|---|---|
| Who is subscribed right now? | `GET /api/admin/reports/active-subscribers` |
| How many messages went out today: delivered, failed, pending? | `GET /api/admin/reports/deliveries` (add `date=YYYY-MM-DD` for another day) |
| Did anyone get the same verse twice? | `GET /api/admin/reports/repeats` (`"repeated": false`) |
| All of the above | `GET /api/admin/reports/summary` |
| Every message with attempt history and failed/completed times | `GET /api/admin/deliveries` |
| Re-run today's failed messages now | `POST /api/admin/deliveries/retry-failed` |

Failed messages are retried automatically: up to 5 attempts with increasing gaps, then the
message is marked `FAILED`, and every 10 minutes failed messages get another round (up to 3 rounds
a day). Numbers that aren't on WhatsApp are not retried automatically.

### Change the wording

- Brand name: `BRAND_NAME=U!D Labs` in `backend/.env`.
- Welcome and daily message text: `backend/src/verses/verse-formatter.ts`
  (`formatWelcomeMessage` and `formatVerseMessage`).

---

## Configure the daily send time

All in `backend/.env` (24-hour `HH:MM`, in `APP_TIMEZONE`, India time by default). Restart the
backend after changing.

| Variable | Default | Meaning |
|---|---|---|
| `DAILY_SEND_TIME` | `07:00` | When the day's verses start going out |
| `SEND_WINDOW_START` | `07:00` | Daily verses are never sent before this… |
| `SEND_WINDOW_END` | `21:30` | …or after this (late ones wait for tomorrow) |
| `APP_TIMEZONE` | `Asia/Kolkata` | Time zone for all of the above |
| `MESSAGES_PER_MINUTE` | `6` | Sending pace (keep it low on a personal number) |

Example, to send at 6:30 AM:

```
DAILY_SEND_TIME=06:30
SEND_WINDOW_START=06:30
```

Keep `SEND_WINDOW_START` at or before `DAILY_SEND_TIME`; otherwise sending waits for the window to open.
The scheduler checks every minute, so sending starts at `DAILY_SEND_TIME`; each person's verse goes out within about a minute after that. At
6 messages per minute, 100 subscribers take about 17 minutes. The welcome message is a direct
reply and goes out at any time of day.

---

## 7. Send real WhatsApp messages from +91 89717 75506

> ⚠️ This uses an unofficial WhatsApp client. WhatsApp may restrict or ban the number. Read "Limitations and risks" in README.md first, and back up your chats.

1. In `backend/.env`, set `MESSAGING_PROVIDER=baileys`.
2. Restart the backend: press `Ctrl+C` in its Terminal, then run `npm run start:dev` again.
3. Open http://localhost:5173/admin. A QR code appears.
4. On the phone with **+91 89717 75506**: WhatsApp → **Settings → Linked devices → Link a device**, and scan the QR code.
   (Or click **Get pairing code** and choose *Link with phone number instead* on the phone.)
5. The status changes to **open**. The link is stored in MySQL, so restarting doesn't require scanning again.

Now real users can subscribe: they enter their name and number, pick a verse type, and get the welcome message from +91 89717 75506 within seconds. Verses follow every day at the send time.

> Test with a **different** number from 89717 75506. A number can't message itself.

> Your Mac must stay awake with the backend running for the daily 07:00 messages to go out. For an always-on free setup, see "Deploy for free" in README.md (Oracle Cloud Always Free VM + `docker compose up -d --build`).

---

## 8. Test the entire flow from scratch

This resets the local database and checks every part of the app, in about 10 minutes.
Run the backend in **console mode** for steps A–E (`MESSAGING_PROVIDER=console` in `backend/.env`),
so nothing goes to real WhatsApp until step F.

The examples use a shell helper for database queries. Define it once per Terminal window:

```bash
db() { docker exec -i verses-mysql mysql -uverses -pverses verses -e "$1" 2>/dev/null; }
```

### A. Fresh database

Stop the backend (`Ctrl+C`), then:

```bash
docker rm -f verses-mysql && docker run -d --name verses-mysql -p 3307:3306 -e MYSQL_DATABASE=verses -e MYSQL_USER=verses -e MYSQL_PASSWORD=verses -e MYSQL_ROOT_PASSWORD=root mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

```bash
until docker exec verses-mysql mysqladmin ping -h127.0.0.1 -uverses -pverses --silent 2>/dev/null; do sleep 2; done; echo "MySQL is ready"
```

```bash
cd ~/Desktop/verse-whatsapp/backend && npm run prisma:migrate:deploy && npm run prisma:seed
```

Expect three migrations applied, and the seed lines shown in step 3.

> This deletes the WhatsApp link too (it's stored in MySQL). After a reset you scan the QR code again in step F.

### B. Automated tests

```bash
cd ~/Desktop/verse-whatsapp/backend && npm test
```

All tests pass.

### C. Prove verses never repeat

```bash
cd ~/Desktop/verse-whatsapp/backend && npm run verify:no-repeats
```

It simulates every day for a test subscriber until each pool is empty (Gita about 2 s, Bible about 2 minutes). Every line should be ✅, ending with `✅ No-repeat guarantee verified`. It cleans up after itself.

### D. Sign-up flow

1. Start the backend (`npm run start:dev`) and the frontend (`npm run dev`).
2. At http://localhost:5173 enter a name, a number and pick **Bible**. The page shows **"Thank you, <name>!"**
   and the backend terminal prints the welcome message.
3. Try the error cases:
   - empty name → "Please enter your name."
   - an invalid number → "Please enter a valid mobile number"
   - the same number again → "This number is already subscribed"
4. Sign up a second number with **Bhagavad Gita**.

### E. Simulate several days

Run this block once per simulated day. It moves existing deliveries one day into the past, runs
"today's" job, and sends right away:

```bash
cd ~/Desktop/verse-whatsapp/backend && KEY=$(grep ^ADMIN_API_KEY .env | cut -d= -f2) && db "UPDATE deliveries SET deliveryDate = deliveryDate - INTERVAL 1 DAY; DELETE FROM job_runs;" && curl -s -X POST localhost:3000/api/admin/jobs/enqueue-today -H "x-admin-key: $KEY" && db "UPDATE deliveries SET nextAttemptAt = NOW(3) WHERE status = 'PENDING';" && echo
```

Wait about 20 seconds, then look at what each subscriber received:

```bash
db "SELECT s.name, d.deliveryDate, d.kind, d.status, v.reference FROM deliveries d JOIN subscribers s ON s.id = d.subscriberId LEFT JOIN verses v ON v.id = d.verseId ORDER BY s.id, d.deliveryDate;"
```

Expect:
- the sign-up day has a `WELCOME` row and usually a `DAILY` verse too;
- every day has one `DAILY` + `SENT` row, with a **different** reference each day;
- the two subscribers get different verses.

To double-check, this must return **no rows**:

```bash
db "SELECT subscriberId, verseId, COUNT(*) FROM deliveries WHERE verseId IS NOT NULL AND status = 'SENT' GROUP BY subscriberId, verseId HAVING COUNT(*) > 1;"
```

The admin page (http://localhost:5173/admin) shows **Repeated verses: 0**.

**Opt-out:** open the "manage subscription" link from step D (or `/manage?token=…`), click
**Unsubscribe**, run one more simulated day, and check that this subscriber's new delivery is `SKIPPED`.

### F. Real WhatsApp

1. Set `MESSAGING_PROVIDER=baileys` in `backend/.env` and restart the backend.
2. Link +91 89717 75506 on `/admin` (step 7).
3. Sign up a **different** real number. That phone receives the welcome message from 89717 75506 within seconds.
4. Run one simulated day (block E). The phone receives its first verse.
5. Reply **STOP** from that phone. You get the unsubscribe confirmation, and the next simulated day sends nothing.
   Reply **START** to resume.

When you're done, keep the subscribers or reset again with step A.

---

## Stopping and restarting

| Action | Command |
|---|---|
| Stop backend / frontend | `Ctrl+C` in their Terminal windows |
| Stop MySQL | `docker stop verses-mysql` |
| Start everything again | `docker start verses-mysql`, then `npm run start:dev` (backend) and `npm run dev` (frontend) |
| Wipe the database completely | `docker rm -f verses-mysql`, then repeat steps 1 and 3 |

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid environment configuration` on start | A value in `backend/.env` is wrong. The message names the variable (e.g. `ADMIN_API_KEY` must be at least 24 characters). |
| `Can't reach database server` | Docker Desktop isn't running, or MySQL is still starting: `docker start verses-mysql` and wait 20 s. |
| `port … is already allocated` | Something else uses that port. Map another one (e.g. `-p 3308:3306`) and use the same port in `DATABASE_URL`. |
| Error mentioning `require()` of an ES module | Node.js is older than 22.12: `node -v`, then upgrade. |
| Admin page says the key is invalid | Use exactly the `ADMIN_API_KEY` from `backend/.env` (restart the backend after changing it). |
| QR code doesn't appear | Make sure `MESSAGING_PROVIDER=baileys` and the backend was restarted. Check the backend terminal for errors. |
| WhatsApp status `logged_out` | The device was unlinked on the phone. Scan the new QR code on `/admin`. |
