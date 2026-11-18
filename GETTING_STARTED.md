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
docker run -d --name verses-mysql -p 3306:3306 -e MYSQL_DATABASE=verses -e MYSQL_USER=verses -e MYSQL_PASSWORD=verses -e MYSQL_ROOT_PASSWORD=root mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

Wait about 20 seconds for MySQL to finish starting.

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

Open `backend/.env` in any editor (for example `open -e .env`) and change:

```
ADMIN_API_KEY=<paste the key you just generated>
MESSAGING_PROVIDER=console
```

`console` prints messages in the terminal instead of sending them on WhatsApp, so it's safe for a first run.
The default `DATABASE_URL=mysql://verses:verses@localhost:3306/verses` already matches step 1.

---

## 3. Create the tables and load the verses

```bash
npx prisma migrate deploy
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
| Manage / unsubscribe | link shown after subscribing (`/manage?token=…`) |
| Admin (WhatsApp link, stats) | http://localhost:5173/admin (enter your `ADMIN_API_KEY`) |

1. Enter a phone number, continue, and pick **Bible** or **Bhagavad Gita**.
2. The page shows a code like `JOIN ABC123` and waits for that WhatsApp message.
3. In console mode nobody can send it on WhatsApp, so simulate the reply (use your admin key, the number you entered and the code shown):

```bash
curl -X POST localhost:3000/api/admin/dev/simulate-inbound -H "x-admin-key: YOUR_ADMIN_KEY" -H 'content-type: application/json' -d '{"phone":"9876543210","text":"JOIN ABC123"}'
```

The page switches to **"You're subscribed!"**, and the welcome verse is printed in the backend terminal.

Optional: send today's verse to all active subscribers right away (it otherwise happens automatically at 07:00 IST):

```bash
curl -X POST localhost:3000/api/admin/jobs/enqueue-today -H "x-admin-key: YOUR_ADMIN_KEY"
```

---

## 7. Send real WhatsApp messages from +91 89717 75506

> ⚠️ This uses an unofficial WhatsApp client. WhatsApp may restrict or ban the number. Read "Limitations and risks" in README.md first, and back up your chats.

1. In `backend/.env`, set `MESSAGING_PROVIDER=baileys`.
2. Restart the backend: press `Ctrl+C` in its Terminal, then run `npm run start:dev` again.
3. Open http://localhost:5173/admin. A QR code appears.
4. On the phone with **+91 89717 75506**: WhatsApp → **Settings → Linked devices → Link a device**, and scan the QR code.
   (Or click **Get pairing code** and choose *Link with phone number instead* on the phone.)
5. The status changes to **open**. The link is stored in MySQL, so restarting doesn't require scanning again.

Now real users can subscribe: they tap **Open WhatsApp and send**, the `JOIN` message reaches your number, and they get their first verse.

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
| `port 3306 is already allocated` | Another MySQL is running. Stop it, or map another port (`-p 3307:3306`) and use `localhost:3307` in `DATABASE_URL`. |
| Error mentioning `require()` of an ES module | Node.js is older than 22.12: `node -v`, then upgrade. |
| Admin page says the key is invalid | Use exactly the `ADMIN_API_KEY` from `backend/.env` (restart the backend after changing it). |
| QR code doesn't appear | Make sure `MESSAGING_PROVIDER=baileys` and the backend was restarted. Check the backend terminal for errors. |
| WhatsApp status `logged_out` | The device was unlinked on the phone. Scan the new QR code on `/admin`. |
