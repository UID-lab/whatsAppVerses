# Deploying for free at https://versesforjoy.duckdns.org

Everything runs on **one free Oracle Cloud server**: MySQL, the backend (NestJS + WhatsApp +
scheduler), the website (nginx) and **Caddy**, which provides HTTPS with a free, auto-renewing
Let's Encrypt certificate. **DuckDNS** gives the free name `versesforjoy.duckdns.org` and points
it at the server.

```
Visitor ──HTTPS──► versesforjoy.duckdns.org  (DuckDNS: name → your server's IP, free)
                        │
                        ▼
              Oracle Cloud "Always Free" VM (Ubuntu, ARM, up to 4 CPU / 24 GB)
              ┌──────────────────────────────────────────────────────────────┐
              │ Caddy :80/:443 (HTTPS, free Let's Encrypt certificate)       │
              │   └──► nginx (React site, /api proxy)                        │
              │          └──► backend (API, scheduler, WhatsApp) ──► MySQL   │
              └──────────────────────────────────────────────────────────────┘
```

## What it costs: nothing

| Item | Cost |
|---|---|
| Oracle Cloud Always Free VM (4 ARM CPUs, 24 GB RAM, 200 GB disk) | free (a card is needed for identity verification) |
| DuckDNS subdomain `versesforjoy.duckdns.org` | free |
| HTTPS certificate (Let's Encrypt via Caddy, renewed automatically) | free |
| MySQL, Node.js, nginx, Caddy, Docker, all libraries | free |
| WhatsApp messages (Baileys, from your own number) | free |

To move to your own domain later (e.g. `versesforjoy.com`), see the appendix. It's a
two-line change.

---

## Part 0: Before you start (checklist)

- [ ] All code is pushed to GitHub (`UID-lab/whatsAppVerses`).
- [ ] You have the phone with **+91 89717 75506** at hand (to link WhatsApp at the end).
- [ ] Back up your WhatsApp chats on that phone (Settings → Chats → Chat backup). Read the
      ban-risk section in README.md.
- [ ] Decide the daily send time (you set it on the admin page after deploying).

The production setup (Docker images, MySQL 8.4, Caddy, migrations, seed, sign-up, scheduler,
reports, rate limiting, no-repeat proof) has been tested end to end with Docker.

---

## Part 1: Create the free Oracle Cloud server (≈ 20 minutes)

1. Sign up at https://signup.cloud.oracle.com.
   - **Home Region:** pick one in India (e.g. *India West (Mumbai)* or *India South (Hyderabad)*).
     You can't change it later, and Always Free servers only run in the home region.
   - A credit/debit card is required for verification. Always Free resources are not charged.
2. On your Mac, create an SSH key (skip if `~/.ssh/id_ed25519.pub` already exists):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" && cat ~/.ssh/id_ed25519.pub
   ```
3. In the Oracle console: **☰ → Compute → Instances → Create instance**:
   - **Name:** `versesforjoy`
   - **Image:** *Canonical Ubuntu 24.04* (click *Edit* → *Change image*)
   - **Shape:** *Change shape* → **Ampere** → `VM.Standard.A1.Flex` → **2 OCPUs, 12 GB memory**
     (look for the "Always Free-eligible" label)
   - **Networking:** keep the defaults (new VCN, public subnet, **assign a public IPv4 address**)
   - **Add SSH keys:** *Paste public keys* → paste the line printed in step 2
   - Click **Create**. After 1–2 minutes it's *Running*. **Copy its Public IP address.**

   If you see "Out of capacity for shape VM.Standard.A1.Flex", choose another *Availability
   Domain* or try again later. Free ARM capacity is popular.
4. **Open ports 80 and 443 in Oracle's firewall.** These are needed for HTTPS and the certificate.
   On the instance page click the **Subnet** link → **Security Lists** → *Default Security List* →
   **Add Ingress Rules**, and add two rules:

   | Source CIDR | IP Protocol | Destination Port |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

5. Connect from your Mac (replace the IP):
   ```bash
   ssh ubuntu@YOUR_SERVER_IP
   ```
6. **Open the same ports in the server's own firewall.** Oracle's Ubuntu images block them by
   default. Run on the server:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT && sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT && sudo netfilter-persistent save
   ```

---

## Part 2: Get the free name on DuckDNS (≈ 5 minutes)

1. Go to https://www.duckdns.org and sign in (GitHub, Google, Reddit or X).
2. In **sub domain**, type `versesforjoy` → **add domain**. If it's already taken, pick another
   name (e.g. `versesforjoy-app`) and use that name everywhere below instead.
3. In the row for `versesforjoy`, put your **server's public IP** in **current ip** →
   **update ip**.
4. Copy your **token** (shown at the top of the page). It's a secret: don't share it.
5. **Keep the IP up to date automatically** (in case Oracle ever changes it). On the server,
   replace `YOUR_TOKEN` and run:
   ```bash
   (crontab -l 2>/dev/null; echo '*/5 * * * * curl -fsS "https://www.duckdns.org/update?domains=versesforjoy&token=YOUR_TOKEN&ip=" -o ~/duckdns.log') | crontab - && curl -fsS "https://www.duckdns.org/update?domains=versesforjoy&token=YOUR_TOKEN&ip=" ; echo
   ```
   It should print `OK`.
6. Check that the name points to your server. On your Mac:
   ```bash
   dig +short versesforjoy.duckdns.org
   ```
   It should print your server's public IP.

---

## Part 3: Install Docker and start the app (≈ 15 minutes)

Run on the server (the `ssh ubuntu@…` session).

1. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu && exit
   ```
   That logs you out. Reconnect with `ssh ubuntu@YOUR_SERVER_IP`.

2. **Get the code:**
   ```bash
   git clone https://github.com/UID-lab/whatsAppVerses.git verses && cd verses
   ```
   If the repository is private, GitHub asks for a username and a personal access token.

3. **Create the settings file** (generates strong random passwords and the admin key, and turns
   on Caddy + HTTPS for your DuckDNS name):
   ```bash
   cat > .env <<EOF
   MYSQL_PASSWORD=$(openssl rand -hex 16)
   MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
   ADMIN_API_KEY=$(openssl rand -hex 24)
   PUBLIC_WEB_URL=https://versesforjoy.duckdns.org
   COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml
   SITE_DOMAIN=versesforjoy.duckdns.org
   WEB_BIND=127.0.0.1
   WEB_PORT=8080
   EOF
   chmod 600 .env && grep ADMIN_API_KEY .env
   ```
   **Save the `ADMIN_API_KEY`** in your password manager. You need it for `/admin` and Swagger.

4. **Build and start** (the first build takes about 5–10 minutes):
   ```bash
   docker compose up -d --build
   ```

5. **Check everything is running:**
   ```bash
   docker compose ps && curl -s localhost:8080/api/health; echo
   ```
   Expect `mysql` *healthy*, `backend` *healthy* (after ~1 minute), `frontend` and `caddy` *Up*,
   and `{"status":"ok","database":"up",…}`.

6. **Check the HTTPS certificate:**
   ```bash
   docker compose logs caddy | grep -iE "certificate obtained|error" | tail -5
   ```
   Expect `certificate obtained successfully`. Then open **https://versesforjoy.duckdns.org**:
   the sign-up page should load with a padlock. On first start the backend applies the
   migrations and loads all verses (Bible, Gita, Quran) into MySQL.

---

## Part 4: Move WhatsApp to the server and go live (≈ 10 minutes)

The same WhatsApp session must never run in two places at once. Stop the Mac copy first.

1. **On your Mac:** stop the local backend (`Ctrl+C` in its window). Optionally stop MySQL too:
   `docker stop verses-mysql`.
2. **On the phone (+91 89717 75506):** WhatsApp → **Settings → Linked devices** → tap the old
   *Ubuntu / Chrome* device → **Log out**.
3. Open **https://versesforjoy.duckdns.org/admin** → sign in with the `ADMIN_API_KEY` from
   Part 3. A QR code appears. On the phone: **Linked devices → Link a device** → scan it. The
   page changes to **Connection: open**. The session is stored in MySQL on the server, so
   restarts don't need a new scan.
4. On the same admin page, set the **Daily send time** (e.g. 9:30 PM) → **Save**.
5. **Test with a second phone** (not 89717 75506): sign up at https://versesforjoy.duckdns.org.
   The welcome arrives within seconds, and the verse at the send time.
6. Check it in Swagger: **https://versesforjoy.duckdns.org/api/docs** → **Authorize** →
   `GET /api/admin/reports/summary`.

The server starts with an empty database: subscribers from your Mac tests are not copied over.
That's intended for going live.

---

## Part 5: Keep it running

### Update to a new version

On the server:
```bash
cd ~/verses && git pull && docker compose up -d --build
```
Migrations and the verse seed run automatically on start. WhatsApp stays linked, and the
certificate is kept.

### Daily database backup (free, on the server)

```bash
mkdir -p ~/backups && (crontab -l 2>/dev/null; echo '15 3 * * * cd ~/verses && docker compose exec -T mysql sh -c "mysqldump -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --single-transaction verses" | gzip > ~/backups/verses-$(date +\%F).sql.gz && find ~/backups -name "*.sql.gz" -mtime +14 -delete') | crontab - && crontab -l
```
This keeps 14 days of backups in `~/backups`. They contain the WhatsApp session and subscribers'
phone numbers: keep them private. To copy one to your Mac:
`scp ubuntu@YOUR_SERVER_IP:~/backups/verses-YYYY-MM-DD.sql.gz ~/Desktop/`.

### Free uptime monitoring

Create a free account at https://uptimerobot.com → **New monitor** → HTTP(s) →
`https://versesforjoy.duckdns.org/api/health` → every 5 minutes → alert to your email.

### Useful commands (on the server, inside `~/verses`)

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Backend log | `docker compose logs -f --tail 100 backend` |
| HTTPS / Caddy log | `docker compose logs --tail 50 caddy` |
| Restart everything | `docker compose restart` |
| Stop / start | `docker compose down` / `docker compose up -d` |
| Admin key | `grep ADMIN_API_KEY .env` |
| SQL shell | `docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" verses'` |

All containers restart automatically after a crash or a server reboot.

---

## Part 6: Security

- **Admin key:** keep `ADMIN_API_KEY` secret. To change it, edit `~/verses/.env` and run
  `docker compose up -d`. Don't reuse a key that was ever pasted into a chat.
- **Optional: a second password for `/admin` and Swagger.** On the server, create a password hash:
  `docker compose exec caddy caddy hash-password --plaintext 'YOUR-PASSWORD'`. Then add this
  inside the site block of `deploy/Caddyfile`, above `reverse_proxy`:
  ```
  	@private path /admin* /api/docs*
  	basic_auth @private {
  		admin PASTE-THE-HASH-HERE
  	}
  ```
  and run `docker compose restart caddy`. The browser then asks for user `admin` + that
  password before showing those pages.
- **Open ports:** only 22 (SSH, key only), 80 and 443 (Caddy). The site and API ports stay
  private inside the server. Rate limits use each visitor's real IP (`TRUST_PROXY_HOPS=2`), and
  faked `X-Forwarded-For` headers are ignored.
- **Oracle "idle" reclamation:** Oracle may reclaim Always Free VMs that look idle for 7 days
  (very low CPU, network and memory). This app is always connected and runs a scheduler, which
  usually counts as activity. Upgrading the account to *Pay As You Go* stops reclamation and still
  costs nothing while you stay within the Always Free limits, but then avoid creating paid
  resources.
- **Privacy:** you store names and phone numbers. Add a short privacy note to the site (what you
  store, why, how to unsubscribe) and only message people who signed up themselves.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `set MYSQL_PASSWORD in .env` / `set SITE_DOMAIN in .env` | the `.env` file from Part 3 step 3 is missing or incomplete; create it in `~/verses` |
| No padlock / Caddy log shows `challenge failed`, `timeout` or `connection refused` | ports 80/443 aren't reachable: re-check Part 1 steps 4 and 6, and that `dig +short versesforjoy.duckdns.org` returns the server's IP. Then `docker compose restart caddy` |
| Caddy log shows `too many certificates` / rate limit | Let's Encrypt limits retries. Wait an hour, then `docker compose restart caddy` |
| Site doesn't load at all | `docker compose ps`; `curl -s localhost:8080/api/health` on the server |
| `backend` keeps restarting | `docker compose logs --tail 80 backend` and look at the first error |
| Admin page shows no QR / `connecting` | wait a minute; check `docker compose logs backend` for `WhatsApp is not linked yet` |
| `Connection replaced by another client` in the log | WhatsApp is also running somewhere else (your Mac): stop it there, then `docker compose restart backend` |
| Out of disk | `docker system prune -af` removes old images; backups live in `~/backups` |

---

## Appendix: moving to your own domain later (e.g. versesforjoy.com)

**Option A: keep Caddy (simplest).**
1. Buy the domain (about US$10–11 per year for a `.com`), e.g. at Cloudflare Registrar.
2. In its DNS, create **A** records for `@` and `www` → your server's public IP (on Cloudflare,
   set the cloud to **DNS only**, grey).
3. On the server, edit `~/verses/.env`:
   ```
   PUBLIC_WEB_URL=https://www.versesforjoy.com
   SITE_DOMAIN=www.versesforjoy.com, versesforjoy.com
   ```
   then run `docker compose up -d`. Caddy gets certificates for the new names automatically.

**Option B: Cloudflare Tunnel (no open ports).** The domain must use Cloudflare DNS. Remove the
`COMPOSE_FILE` and `SITE_DOMAIN` lines from `.env` (Caddy no longer needed), run
`docker compose up -d --remove-orphans`, then in Cloudflare **Zero Trust → Networks → Tunnels →
Create a tunnel → Cloudflared**. Install the connector on the server with the command shown
(Debian, arm64), and add public hostnames `www.versesforjoy.com` and `versesforjoy.com` →
**HTTP** `localhost:8080`. You can then close ports 80/443 again.
