# Table: `khanan_data`

**Mongo:** database `khanan_db`, collection **`khanandatas`**.  
**Mongoose:** [`backend/src/models/KhananData.js`](../../../backend/src/models/KhananData.js)

## Observed in Mongo (update as you re-verify)

| Metric | Value |
|--------|--------|
| **Collection names** | Compass lists **`khanan_data`** and **`khanandatas`** — possible **Spring (Java)** vs **Mongoose (Node)** naming; **count both** before ETL. **`khanan_data`** shown **~25M** documents in Compass (prod). |
| **Legacy field** | Sample docs may include **`_class`** (e.g. `com.example.demo.entity.KhananData`) — harmless for Postgres; **omit column** or store optional `legacy_class text`. |
| **Sample cluster** | Ek alag snapshot par ~1145 docs — **non‑prod / old cluster**; prod sizing **25M** se karo. |
| **Avg document size** | ~526 bytes (small sample); VPS disk plan **100 GB+** for 25M rows + indexes. |
| **Indexes** | `_id_`, `district_1_date_1`, `challanNo_1`, `vehicleRegNo_1` (`nindexes: 4`) — confirm on prod collection you migrate. |

**Target Postgres:** **Hostinger VPS** — migrate via **streaming/chunked ETL**; **do not** download full 25M rows to a laptop.

## Columns (PostgreSQL target)

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | `bigserial` or `uuid` | NO | PK |
| `district` | `text` | NO | |
| `consigner_name` | `text` | NO | |
| `date` | `text` | NO | **Display string** in Mongo (e.g. `27-Apr-2026`); API uses `$in` list of formatted dates — keep `text` for zero behaviour change, or migrate to `date` later |
| `source_type` | `text` | NO | |
| `consignee_name` | `text` | NO | |
| `challan_no` | `text` | NO | **UNIQUE** — dedupe / Puppeteer `11000` handling |
| `mineral_name` | `text` | NO | |
| `mineral_category` | `text` | NO | |
| `vehicle_reg_no` | `text` | NO | Index |
| `destination` | `text` | NO | |
| `transported_date` | `text` | NO | Format may differ from `date` (e.g. `27 Apr 2026`) |
| `quantity` | `numeric` or `text` | NO | Sample: `40.360` — `numeric(14,3)` reasonable |
| `unit` | `text` | NO | e.g. `MT` |
| `check_status` | `text` | YES | Default conceptually `'Pending'` in schema |
| `created_at` | `timestamptz` | NO | |
| `updated_at` | `timestamptz` | NO | |

## Optional migration column

| Column | Type | Notes |
|--------|------|--------|
| `legacy_mongo_id` | `text` | Optional UNIQUE; maps Mongo `_id` |

## Constraints & indexes (parity with Mongoose)

- **UNIQUE** (`challan_no`)
- **INDEX** `(district, date)` — matches `district_1_date_1`
- **INDEX** (`vehicle_reg_no`) — matches `vehicleRegNo_1`

## Sample Mongo document (shape reference)

Document fields are **flat** (no nested objects). Example pattern:

- `district`, `consignerName`, `date`, `sourceType`, `consigneeName`, `challanNo`, `mineralName`, `mineralCategory`, `vehicleRegNo`, `destination`, `transportedDate`, `quantity`, `unit`, `checkStatus`, `createdAt`, `updatedAt`, `__v`

## Mongo → PG mapping (field names)

| Mongo | Postgres column |
|-------|-----------------|
| `_id` | `id` / `legacy_mongo_id` |
| `district` | `district` |
| `consignerName` | `consigner_name` |
| `date` | `date` |
| `sourceType` | `source_type` |
| `consigneeName` | `consignee_name` |
| `challanNo` | `challan_no` |
| `mineralName` | `mineral_name` |
| `mineralCategory` | `mineral_category` |
| `vehicleRegNo` | `vehicle_reg_no` |
| `destination` | `destination` |
| `transportedDate` | `transported_date` |
| `quantity` | `quantity` |
| `unit` | `unit` |
| `checkStatus` | `check_status` |
| `__v` | omit or `schema_version` |
| `createdAt` | `created_at` |
| `updatedAt` | `updated_at` |

---

*After `getIndexes()` / count refresh, update the “Observed in Mongo” table above.*
