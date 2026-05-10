# Table: `users`

**Mongo:** collection `users` (verify exact name with `show collections` in `khanan_db`).  
**Mongoose:** [`backend/src/models/User.js`](../../../backend/src/models/User.js)

## Observed in Mongo

| Metric | Value |
|--------|--------|
| **Documents** | **23** (`estimatedDocumentCount`) |
| **Indexes** | `_id_` (default); **`username_1`** — `{ username: 1 }`, **unique** (`background: true`) |

### Sample documents (shape)

**Variant A — names present:** `firstName`, `lastName`, `email`, `username`, `password` (**bcrypt** `$2a$10$…`), `roles` (`USER`), `tokenVersion`, timestamps, `__v`.

**Variant B — sparse names:** same core fields but **`firstName` / `lastName` absent** (only `email`, `username`, hash, `roles`, `tokenVersion`, timestamps). Confirms Postgres **`first_name` / `last_name` nullable**.

**ETL / hygiene:**

- Password stays **one text column** storing bcrypt string — copy as-is to Postgres; **never paste live hashes into repo READMEs** (redact in docs).
- `roles` stored as **string** (`USER`), not array — matches current model.

---

## Columns (PostgreSQL target)

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | `uuid` or `bigserial` | NO | PK; JWT/API may expose this instead of Mongo `_id` — see migration doc Section 10 |
| `first_name` | `text` | YES | `trim` in app |
| `last_name` | `text` | YES | |
| `email` | `text` | YES | `lowercase` in app; index if filtered |
| `username` | `text` | NO | **UNIQUE**, `trim` |
| `password` | `text` | NO | Hashed secret — never log |
| `roles` | `text` | YES | Default `'USER'` |
| `token_version` | `integer` | NO | Default `0`; bump on login for JWT invalidation |
| `created_at` | `timestamptz` | NO | From Mongoose `timestamps` |
| `updated_at` | `timestamptz` | NO | |

## Constraints

- **PRIMARY KEY** (`id`)
- **UNIQUE** (`username`)

## Optional migration column

| Column | Type | Notes |
|--------|------|--------|
| `legacy_mongo_id` | `text` | Optional UNIQUE; trace rows back to Mongo `_id` during validation |

## Indexes

- Unique constraint on `username` covers lookup by login.
- Add index on `email` only if queries use it.

## Mongo → PG mapping (field names)

| Mongo (User.js) | Postgres column |
|-----------------|-----------------|
| `_id` | `id` / `legacy_mongo_id` |
| `firstName` | `first_name` |
| `lastName` | `last_name` |
| `email` | `email` |
| `username` | `username` |
| `password` | `password` |
| `roles` | `roles` |
| `tokenVersion` | `token_version` |
| `createdAt` | `created_at` |
| `updatedAt` | `updated_at` |

