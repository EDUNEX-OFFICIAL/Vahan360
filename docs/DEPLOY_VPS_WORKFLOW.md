# Vahan360 — VPS deploy workflow (Ubuntu + Docker + GitHub)

Ye flow **Hostinger KVM / koi bhi Ubuntu VPS** par use karo. Code **GitHub** se aata hai; server par sirf **pull + env + compose** chalana hai.

---

## 0) Ek baar laptop / CI se (developers)

1. Changes commit karo, **GitHub** par push: `main` (ya jo deploy branch ho).
2. **Secrets Git par mat daalo:** `.env`, passwords, `JWT_SECRET` — `.gitignore` mein rahenge.

---

## 1) VPS pe pehli baar (one-time setup)

SSH:

```bash
ssh root@YOUR_SERVER_IP
```

System + firewall:

```bash
apt update && apt upgrade -y
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Docker (official): [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) — `docker-ce`, `docker-compose-plugin`. Verify:

```bash
docker --version
docker compose version
```

Tools:

```bash
apt install -y git
```

---

## 2) Code directory — hamesha yahi use karo

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/EDUNEX-OFFICIAL/Vahan360.git vahan360
cd /opt/vahan360
```

Agar repo **private** hai: deploy key / PAT se clone, ya SSH URL.

**Updates ke liye (baar baar):**

```bash
cd /opt/vahan360
git pull origin main
```

---

## 3) `.env` — sirf is path par

File: **`/opt/vahan360/.env`** (root ke `~/` par nahi — warna `docker compose` variables nahi padhega).

```bash
nano /opt/vahan360/.env
```

Minimum:

```env
JWT_SECRET=paste_openssl_or_long_random_min_32_chars
V360_POSTGRES_USER=vahan360
V360_POSTGRES_PASSWORD=strong_unique_password
V360_POSTGRES_DB=vahan360
```

`JWT_SECRET` generate (VPS par):

```bash
openssl rand -base64 48
```

---

## 4) `docker-compose.yml` — kabhi bhi ye mat karna

- **`./nginx/html:...` ko terminal command mat chalao** — wo YAML line hai, shell command nahi.
- Agar compose edit karna ho to poori file valid rahe: top level `services:` / `version:`; sirf ek `- volume` line se file shuru mat karo (warna `yaml: construct errors`).

Is repo mein **nginx static** ke liye volume already compose mein hai; alag se paste karne ki zaroorat nahi.

---

## 5) Pehli deploy — DB + app

```bash
cd /opt/vahan360
docker compose up -d postgres
sleep 15
docker compose run --rm backend npx prisma db push
docker compose up -d --build
docker compose ps
```

Health (server par):

```bash
curl -s http://127.0.0.1/health
```

Browser se: `http://YOUR_SERVER_IP/`

### 5.1) Default admin (`admin` / `admin123`)

Login 500 / empty DB ho to schema + default admin:

```bash
cd /opt/vahan360
chmod +x scripts/seed-admin-docker.sh
./scripts/seed-admin-docker.sh
```

Ya manually: `docker compose run --rm backend npx prisma db push` phir `docker compose run --rm backend npm run sync:user`.

**CI deploy workflow** sirf `git pull` + `docker compose up` chalata hai — `db push` / `sync:user` **yahan nahi**, kyunki galat `.env` vs purana Postgres volume par **P1000 (auth failed)** se poora deploy fail ho sakta hai. Pehle **`/opt/vahan360/.env`** ke `V360_POSTGRES_*` ko **us password ke saath match** karo jo volume pehli baar create hote waqt use hua tha (ya naya volume + consistent password).

---

## 6) Windows se file copy (jab Git use na ho)

`scp` **Windows PowerShell** par chalao — **VPS ke andar nahi**. Windows path `D:\...` Linux VPS par valid nahi.

```powershell
scp "D:\path\to\local\file" root@YOUR_SERVER_IP:/opt/vahan360/
```

---

## 7) Production tips

- Postgres port **5432** host par expose hai — public internet se DB protect karo (UFW block ya compose se host port hata do).
- Domain + HTTPS: DNS A record → VPS IP; Certbot / SSL certs `nginx/ssl` + `nginx.conf` update.
- `JWT_SECRET` rotate karne par sab users dubara login karenge.

---

## 8) GitHub Actions — push / manual se VPS auto deploy (SSH)

Repo mein workflow: [`deploy-vps.yml`](../.github/workflows/deploy-vps.yml).  
`main` par **push** hone par ya **Actions → Deploy VPS → Run workflow** (`workflow_dispatch`) se VPS par `git pull` + `docker compose up -d --build` chalega.

### 8.1) VPS par deploy SSH key (recommended: alag key, sirf deploy)

**Apne laptop par** (ya VPS par) key banao — password empty chhod sakte ho:

```bash
ssh-keygen -t ed25519 -C "github-actions-vahan360-deploy" -f ./gha-vahan360-deploy -N ""
```

- **Public key** (`gha-vahan360-deploy.pub`) ko VPS par user ke `~/.ssh/authorized_keys` mein append karo jisse Actions login karega (`root` ya dedicated user).
- **Private key** (`gha-vahan360-deploy`) ka **poora** content (including `BEGIN` / `END` lines) GitHub Secret `VPS_SSH_PRIVATE_KEY` mein paste karo.

**Dedicated user (optional, zyada safe):**

```bash
adduser --disabled-password deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
# public key yahan append karo:
nano /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

Is user ko **`/opt/vahan360`** par read/write chahiye (clone ya `chown -R deploy:deploy /opt/vahan360`), taake `git pull` + `docker compose` chal sake.

### 8.2) SSH hardening (short)

- `PermitRootLogin prohibit-password` ya `no` + sirf key auth.
- `PasswordAuthentication no`.
- `fail2ban` install karna worthwhile hai brute-force ke liye: `apt install -y fail2ban`.

### 8.3) GitHub repo Secrets (Settings → Secrets and variables → Actions)

| Secret | Example / note |
|--------|----------------|
| `VPS_HOST` | `82.29.160.50` ya domain |
| `VPS_USER` | `root` ya `deploy` |
| `VPS_SSH_PRIVATE_KEY` | OpenSSH private key **full PEM** (multiline) |

SSH **non-default port** ho to `.github/workflows/deploy-vps.yml` mein `appleboy/ssh-action` ke neeche `port: YOUR_PORT` add karo (default workflow mein port 22 assume hai).

### 8.3b) GitHub Actions: `dial tcp …:22: i/o timeout`

Matlab **runner se VPS par TCP 22** tak connection **banti hi nahi** (firewall / panel / galat `VPS_HOST`). Code fix se ye solve nahi hota.

**Checklist:**

1. **hPanel / Hostinger → VPS → Firewall (ya Security)** — inbound **TCP 22** allow ho (source **Anywhere** / `0.0.0.0/0` jab tak test kar rahe ho). Bahut VPS par default sirf limited rules hoti hain; **laptop se `ssh` chalna** = tumhara IP allow hai, **GitHub ka IP alag** hota hai.
2. Server par: `ufw status` — **`22/tcp` ALLOW** (ya `OpenSSH`) hona chahiye agar UFW on ho.
3. **Secret `VPS_HOST`** — sahi **public IPv4** (ya jo SSH hostname ho); typo / purana IP na ho.
4. Optional: [GitHub Actions IP ranges](https://api.github.com/meta) (`actions` CIDRs) allowlist — ranges badal sakti hain; chhote setups ke liye **22 open + sirf SSH key auth** zyada practical hai.

### 8.4) Pehli baar verify (recommended order)

1. VPS par pehle **manual** [§5](#5-pehli-deploy--db--app) complete karo taake `/opt/vahan360` + `.env` ready hon.
2. GitHub par Secrets set karo.
3. **Actions** tab → **Deploy VPS** → **Run workflow** (manual). Logs green hon tab hi `push` par auto deploy bharosemand hai.
4. **Private repo:** VPS par `git clone` / `git pull` ke liye GitHub access hona chahiye (repo Deploy key read-only, ya `https` + credential helper, ya SSH clone URL + deploy key).

### 8.5) Manual same commands (server par)

[scripts/deploy-on-vps.sh](../scripts/deploy-on-vps.sh) — optional helper:

```bash
chmod +x /opt/vahan360/scripts/deploy-on-vps.sh
/opt/vahan360/scripts/deploy-on-vps.sh
```

---

## Quick checklist (har deploy)

| Step | Command / action |
|------|-------------------|
| Auto | `main` par push → GitHub Actions **Deploy VPS** (Secrets set hon) |
| Manual | `cd /opt/vahan360 && git pull origin main` |
| | `.env` check (missing vars nahi) |
| | `docker compose up -d --build` |
| | `docker compose ps` + `/health` |

---

*Repo: [EDUNEX-OFFICIAL/Vahan360](https://github.com/EDUNEX-OFFICIAL/Vahan360)*
