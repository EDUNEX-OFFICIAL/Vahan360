# Table: `vehicle_trip_summary`

**Mongo:** collection **`vehicletripsummaries`** (verify with `show collections` in `khanan_db`).  
**Mongoose:** [`apps/api-express/src/models/VehicleTripSummary.js`](../../../apps/api-express/src/models/VehicleTripSummary.js)

## Observed in Mongo

| Metric | Value |
|--------|--------|
| **NS** | `khanan_db.vehicletripsummaries` |
| **Documents** | **514** (`stats().count` / `estimatedDocumentCount`) |
| **`avgObjSize`** | ~661 bytes |
| **`nindexes`** | **15** (incl. `_id_`) |
| **Data + index footprint** | ~340 KB data, ~733 KB indexes (`stats()` snapshot) |

### Indexes (from production cluster — mirror in Postgres)

| Mongo index name | Keys | Notes |
|------------------|------|--------|
| `_id_` | `_id` | PK |
| `vehicleRegNo_1` | `vehicleRegNo` **asc**, **unique** | Primary business key |
| `ownerName_1` | `ownerName` | |
| `status_1` | `status` | Sparse sample doc mein missing ho sakta hai; collection par index hai → kuch rows populated |
| `vehicleCategory_1_customerType_1` | `vehicleCategory`, `customerType` | compound |
| `make_1_model_1` | `make`, `model` | compound |
| `currentDistrict_1_currentPincode_1` | `currentDistrict`, `currentPincode` | compound |
| `permanentDistrict_1_permanentPincode_1` | `permanentDistrict`, `permanentPincode` | compound |
| `createdAt_-1` | `createdAt` **desc** | list sort |
| `insuranceDueDate_1` | `insuranceDueDate` | |
| `fitnessValidUpto_1` | `fitnessValidUpto` | |
| `pollutionValidUpto_1` | `pollutionValidUpto` | |
| `permitValidUpto_1` | `permitValidUpto` | |
| `nextFollowUp_1` | `nextFollowUp` | |
| `assignedExecutive_1` | `assignedExecutive` | |

Postgres side: same columns **`snake_case`** + `CREATE INDEX ...` / `UNIQUE (vehicle_reg_no)`.

### Sample document (sparse aggregate row)

Example reg **`JH12N9469`** — aggregation-filled fields present; full CRM often **partial**.

**Fields present in sample:** `vehicleRegNo`, `totalTrips`, `totalMTWeight`, `sandTrips`, `sandMTWeight`, `stoneTrips`, `stoneMTWeight`, `ownerName`, `currentDistrict`, `currentFullAddress`, `permanentDistrict`, `permanentFullAddress`, `vehicleCategory` (`2WN`), `customerType` (`Individual`), `leadSource`, `offence`, `khananPhone` (empty string), `insuranceDueDate`, `permitValidUpto`, `fitnessValidUpto`, `pollutionValidUpto` (all Mongo `Date` / UTC ISO), `createdAt`, `updatedAt`, `__v`.

**Not in this sample** (expect **NULL** on many rows): `status`, `nextFollowUp`, `assignedExecutive`, `mobileNo`, `make`, `model`, `fatherName`, `currentPincode`, `permanentPincode`, `insuranceCompany`, `insurancePolicyNo`, `mvTaxPaidUpto`, PAN/GST columns — **indexes above show these fields are used on subset of documents** (CRM / filters).

**ETL notes:**

- Mongo date fields → Postgres **`timestamptz`** (store UTC).
- Empty string **`khananPhone: ''`** vs **`NULL`** — pick one rule on import for consistency.

## Columns (PostgreSQL target)

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | `bigserial` or `uuid` | NO | PK |
| `vehicle_reg_no` | `text` | NO | **UNIQUE**, normalized key |
| `total_trips` | `integer` | NO | Default `0` |
| `total_mt_weight` | `double precision` or `numeric` | NO | Default `0` |
| `sand_trips` | `integer` | NO | Default `0` |
| `sand_mt_weight` | `double precision` or `numeric` | NO | Default `0` |
| `stone_trips` | `integer` | NO | Default `0` |
| `stone_mt_weight` | `double precision` or `numeric` | NO | Default `0` |
| `owner_name` | `text` | YES | |
| `mobile_no` | `text` | YES | |
| `make` | `text` | YES | |
| `model` | `text` | YES | |
| `gvw_kgs` | `double precision` | YES | |
| `unladen_weight_kgs` | `double precision` | YES | |
| `vehicle_category` | `text` | YES | |
| `father_name` | `text` | YES | |
| `current_full_address` | `text` | YES | |
| `current_pincode` | `text` | YES | |
| `current_district` | `text` | YES | |
| `permanent_full_address` | `text` | YES | |
| `permanent_pincode` | `text` | YES | |
| `permanent_district` | `text` | YES | |
| `insurance_company` | `text` | YES | |
| `insurance_policy_no` | `text` | YES | |
| `insurance_due_date` | `timestamptz` | YES | Mongo `Date` |
| `permit_valid_upto` | `timestamptz` | YES | |
| `fitness_valid_upto` | `timestamptz` | YES | |
| `pollution_valid_upto` | `timestamptz` | YES | |
| `mv_tax_paid_upto` | `timestamptz` | YES | |
| `lead_source` | `text` | YES | |
| `offence` | `text` | YES | |
| `pan_number` | `text` | YES | |
| `pan_address` | `text` | YES | |
| `gstin` | `text` | YES | |
| `legal_name` | `text` | YES | |
| `gst_trade_name` | `text` | YES | |
| `gst_contact` | `text` | YES | |
| `gst_email` | `text` | YES | |
| `khanan_phone` | `text` | YES | |
| `customer_type` | `text` | YES | |
| `status` | `text` | NO | Check constraint: `pending`, `in-progress`, `completed` — or Postgres `ENUM` |
| `next_follow_up` | `timestamptz` | YES | |
| `assigned_executive` | `text` | YES | |
| `created_at` | `timestamptz` | NO | |
| `updated_at` | `timestamptz` | NO | |

## Constraints

- **PRIMARY KEY** (`id`)
- **UNIQUE** (`vehicle_reg_no`)

## Indexes (mirror Mongoose)

Create after measuring queries on staging; intended parity with [`VehicleTripSummary.js`](../../../apps/api-express/src/models/VehicleTripSummary.js):

- `owner_name`
- `status`
- `(vehicle_category, customer_type)`
- `(make, model)`
- `(current_district, current_pincode)`
- `(permanent_district, permanent_pincode)`
- `created_at` DESC (or btree default for sort)
- `insurance_due_date`, `fitness_valid_upto`, `pollution_valid_upto`, `permit_valid_upto`, `next_follow_up`, `assigned_executive`

## Mongo → PG mapping (camelCase → snake_case)

`vehicleRegNo` → `vehicle_reg_no`, `totalTrips` → `total_trips`, `totalMTWeight` → `total_mt_weight`, `sandTrips` → `sand_trips`, `sandMTWeight` → `sand_mt_weight`, `stoneTrips` → `stone_trips`, `stoneMTWeight` → `stone_mt_weight`, `ownerName` → `owner_name`, `mobileNo` → `mobile_no`, `gvwKgs` → `gvw_kgs`, `unladenWeightKgs` → `unladen_weight_kgs`, `vehicleCategory` → `vehicle_category`, `fatherName` → `father_name`, `currentFullAddress` → `current_full_address`, `currentPincode` → `current_pincode`, `currentDistrict` → `current_district`, `permanentFullAddress` → `permanent_full_address`, `permanentPincode` → `permanent_pincode`, `permanentDistrict` → `permanent_district`, `insuranceCompany` → `insurance_company`, `insurancePolicyNo` → `insurance_policy_no`, `insuranceDueDate` → `insurance_due_date`, `permitValidUpto` → `permit_valid_upto`, `fitnessValidUpto` → `fitness_valid_upto`, `pollutionValidUpto` → `pollution_valid_upto`, `mvTaxPaidUpto` → `mv_tax_paid_upto`, `leadSource` → `lead_source`, `panNumber` → `pan_number`, `panAddress` → `pan_address`, `gstTradeName` → `gst_trade_name`, `gstContact` → `gst_contact`, `gstEmail` → `gst_email`, `khananPhone` → `khanan_phone`, `customerType` → `customer_type`, `nextFollowUp` → `next_follow_up`, `assignedExecutive` → `assigned_executive`, `createdAt` → `created_at`, `updatedAt` → `updated_at`.

