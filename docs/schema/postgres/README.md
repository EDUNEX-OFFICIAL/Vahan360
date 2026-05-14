# PostgreSQL schema documentation (Vahan360)

Target tables for **PostgreSQL** (local dev first, then **Hostinger VPS** — see [migration doc](../../MONGODB_TO_POSTGRESQL_MIGRATION.md) “Local-first scrape → quick VPS deploy”). Historical **~25M** Mongo rows: **VPS chunked ETL** only; **new scrape** can start small on localhost then same deploy to VPS. Each file is **one table**: columns, constraints, indexes, and Mongo source mapping.

| Table | File | Mongo collection / model |
|--------|------|---------------------------|
| `users` | [users.md](./users.md) | `users` → [`User.js`](../../../apps/api-express/src/models/User.js) |
| `khanan_data` | [khanan_data.md](./khanan_data.md) | `khanandatas` → [`KhananData.js`](../../../apps/api-express/src/models/KhananData.js) |
| `vehicle_trip_summary` | [vehicle_trip_summary.md](./vehicle_trip_summary.md) | `vehicletripsummaries` → [`VehicleTripSummary.js`](../../../apps/api-express/src/models/VehicleTripSummary.js) |

**Runbook:** [MONGODB_TO_POSTGRESQL_MIGRATION.md](../../MONGODB_TO_POSTGRESQL_MIGRATION.md)

Update these files when Compass / `mongosh` se nayi observation aaye (counts, extra fields, index tweaks).
