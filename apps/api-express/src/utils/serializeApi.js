function serializeDecimal(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return value;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    try {
      return value.toNumber();
    } catch {
      /* fall through */
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function serializeKhananRow(row) {
  if (!row) return row;
  const o =
    typeof row === "object" && row !== null && typeof row.toJSON === "function"
      ? row.toJSON()
      : { ...row };
  const { id, quantity, ...rest } = o;
  const idStr = id != null ? String(id) : undefined;
  return {
    ...rest,
    _id: idStr,
    id: idStr,
    quantity: serializeDecimal(quantity),
  };
}

function serializeVehicleTripSummaryRow(row) {
  if (!row) return row;
  const o = { ...row };
  const { id, totalMtWeight, sandMtWeight, stoneMtWeight, ...rest } = o;
  const idStr = id != null ? String(id) : undefined;
  return {
    ...rest,
    _id: idStr,
    id: idStr,
    totalMTWeight: totalMtWeight,
    sandMTWeight: sandMtWeight,
    stoneMTWeight: stoneMtWeight,
  };
}

module.exports = {
  serializeKhananRow,
  serializeVehicleTripSummaryRow,
  serializeDecimal,
};
