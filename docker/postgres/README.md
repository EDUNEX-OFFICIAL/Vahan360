# Vahan360 local PostgreSQL (Docker)

pgAdmin cannot be opened from this repo automatically — use the values below.

## Connection (from Windows / pgAdmin)

| Field | Value |
|--------|--------|
| Host | `127.0.0.1` |
| Port | `5433` |
| Database | `vahan360` |
| Username | `vahan360` |
| Password | **`vahan360localdev`** after you apply the `docker-compose.yml` snippet below — no spaces |

Enable **Save password** in pgAdmin.

## Fix `docker-compose.yml` (recommended)

Replace the `postgres` service `environment` block with **fixed** values so a root `.env` cannot override `V360_POSTGRES_PASSWORD` and confuse pgAdmin:

```yaml
    environment:
      POSTGRES_USER: vahan360
      POSTGRES_PASSWORD: vahan360localdev
      POSTGRES_DB: vahan360
```

Also set the healthcheck to:

```yaml
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vahan360 -d vahan360"]
```

## If you get `password authentication failed`

Postgres only reads `POSTGRES_PASSWORD` on **first** data directory init. After that, changing compose does not change the DB password.

**Reset local data (wipes DB):**

```powershell
cd "d:\AK47\Officials\Development\Projects\Vahan360\spybot both\vahan360"
docker compose stop postgres
docker compose rm -f postgres
docker volume rm vahan360_vahan360_pg_data
docker compose up -d postgres
```

Then connect in pgAdmin with password **`vahan360localdev`**.

## Verify from PowerShell (optional)

```powershell
docker exec vahan360-postgres psql -U vahan360 -d vahan360 -c "SELECT 1;"
```

TCP + password (matches pgAdmin path):

```powershell
docker run --rm -e PGPASSWORD=vahan360localdev postgres:15-alpine psql -h host.docker.internal -p 5433 -U vahan360 -d vahan360 -c "SELECT 1;"
```

If the second command fails but the first works, the password in compose and pgAdmin do not match the volume — do the volume reset above.

---

## Production: SCRAM-only, `trust` mat rakho

- TCP connections ko **`trust`** se mat chhoro — koi bhi port tak pahunch kar bina password DB use kar sakta hai.
- Stock **`postgres` Docker image** host connections ke liye password auth use karti hai (**SCRAM-SHA-256**). Repo ke `docker-compose.yml` mein `POSTGRES_HOST_AUTH_METHOD=scram-sha-256` **naya volume / pehli init** par explicitly set hai.
- Agar tumne debug ke liye **`pg_hba.conf`** mein `trust` lagaya tha: wapas **`scram-sha-256`** (ya safe alternative) pe lao, `pg_reload_conf()` / container restart, phir client se password verify karo.
- **Pehle se bana hua data volume** apna purana `pg_hba` retain karta hai — sirf env change se purani file overwrite nahi hoti; zarurat ho to manually edit karo ya sirf **dev** par volume wipe (upar "Reset local data").
