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

## Quick checklist (har deploy)

| Step | Command / action |
|------|-------------------|
| 1 | `cd /opt/vahan360 && git pull origin main` |
| 2 | `.env` check (missing vars nahi) |
| 3 | `docker compose up -d --build` |
| 4 | `docker compose ps` + `/health` |

---

*Repo: [EDUNEX-OFFICIAL/Vahan360](https://github.com/EDUNEX-OFFICIAL/Vahan360)*
