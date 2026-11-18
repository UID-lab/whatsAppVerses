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
Bible (KJV): 31102 verses (31102 new), 420 in daily rotation (0 rotation updates)
Bhagavad Gita: 701 verses (701 new), 654 in daily rotation (0 rotation updates)
```

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

1. Enter your **name** and **WhatsApp number**, continue, and pick **Bible** or **Bhagavad Gita**.
2. The page says **"Thank you, <name>!"**. The subscriber is saved right away, and this welcome
   message is sent (printed in the backend terminal in console mode):

   ```
   Hi <name>,

   Thank you for subscribing to U!D Labs. Your verses will start from tomorrow morning.

   Let's hold hands and begin the path with joy!

   Reply STOP anytime to unsubscribe.
   ```

3. From the next morning, a verse is sent every day at `DAILY_SEND_TIME` (see below).

To send today's verses right away for testing (subscribers who got the welcome message today
are skipped until tomorrow):

```bash
curl -X POST localhost:3000/api/admin/jobs/enqueue-today -H "x-admin-key: YOUR_ADMIN_KEY"
```

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
The scheduler checks every 5 minutes, so sending starts within 5 minutes of `DAILY_SEND_TIME`. At
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

Now real users can subscribe: they enter their name and number, pick a verse type, and get the welcome message from +91 89717 75506 within seconds. Verses follow every morning.

> Test with a **different** number from 89717 75506. A number can't message itself.

> Your Mac must stay awake with the backend running for the daily 07:00 messages to go out. For an always-on free setup, see "Deploy for free" in README.md (Oracle Cloud Always Free VM + `docker compose up -d --build`).

---

## 8. Run the tests (optional)

```bash
cd ~/Desktop/verse-whatsapp/backend
npm test
```

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
