const { mapSpringStatusToPipelineStatus } = require('./leadLifecycle');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilterRegex(value, operator) {
  const escaped = escapeRegex(value);
  if (operator === 'equals') return new RegExp(`^${escaped}$`, 'i');
  if (operator === 'startsWith') return new RegExp(`^${escaped}`, 'i');
  if (operator === 'endsWith') return new RegExp(`${escaped}$`, 'i');
  return new RegExp(escaped, 'i');
}

function addDateRange(query, field, fromValue, toValue) {
  if (!fromValue && !toValue) return;
  const range = {};
  if (fromValue) {
    const fromDate = new Date(fromValue);
    if (!Number.isNaN(fromDate.getTime())) range.$gte = fromDate;
  }
  if (toValue) {
    const toDate = new Date(toValue);
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      range.$lte = toDate;
    }
  }
  if (Object.keys(range).length > 0) query[field] = range;
}

function buildVehicleTripSummaryQuery(queryParams = {}) {
  const {
    vehicleRegNo,
    ownerName,
    mobileNo,
    panNumber,
    make,
    model,
    vehicleCategory,
    customerType,
    currentDistrict,
    permanentDistrict,
    currentPincode,
    permanentPincode,
    assignedExecutive,
    leadSource,
    insuranceCompany,
    minTrips,
    minWeight,
    status,
    filterField,
    filterOp,
    filterValue,
    createdDateFrom,
    createdDateTo,
    insuranceDueDateFrom,
    insuranceDueDateTo,
    fitnessValidUptoFrom,
    fitnessValidUptoTo,
    pollutionValidUptoFrom,
    pollutionValidUptoTo,
    permitValidUptoFrom,
    permitValidUptoTo,
    nextFollowUpFrom,
    nextFollowUpTo,
  } = queryParams;

  const query = {};
  if (vehicleRegNo) {
    query.$or = [
      { vehicleRegNo: new RegExp(vehicleRegNo, 'i') },
      { ownerName: new RegExp(vehicleRegNo, 'i') },
    ];
  }
  if (ownerName) query.ownerName = new RegExp(ownerName, 'i');
  if (mobileNo) query.mobileNo = new RegExp(mobileNo, 'i');
  if (panNumber) query.panNumber = new RegExp(panNumber, 'i');
  if (make) query.make = new RegExp(make, 'i');
  if (model) query.model = new RegExp(model, 'i');
  if (vehicleCategory) query.vehicleCategory = new RegExp(`^${escapeRegex(vehicleCategory)}$`, 'i');
  if (customerType) query.customerType = new RegExp(`^${escapeRegex(customerType)}$`, 'i');
  if (currentDistrict) query.currentDistrict = new RegExp(currentDistrict, 'i');
  if (permanentDistrict) query.permanentDistrict = new RegExp(permanentDistrict, 'i');
  if (currentPincode) query.currentPincode = new RegExp(currentPincode, 'i');
  if (permanentPincode) query.permanentPincode = new RegExp(permanentPincode, 'i');
  if (assignedExecutive) query.assignedExecutive = new RegExp(assignedExecutive, 'i');
  if (leadSource) query.leadSource = new RegExp(leadSource, 'i');
  if (insuranceCompany) query.insuranceCompany = new RegExp(insuranceCompany, 'i');

  if (minTrips !== undefined && minTrips !== '') {
    const parsedTrips = Number.parseInt(minTrips, 10);
    if (!Number.isNaN(parsedTrips)) query.totalTrips = { $gte: parsedTrips };
  }
  if (minWeight !== undefined && minWeight !== '') {
    const parsedWeight = Number.parseFloat(minWeight);
    if (!Number.isNaN(parsedWeight)) query.totalMTWeight = { $gte: parsedWeight };
  }

  if (status) {
    const mappedStatus = mapSpringStatusToPipelineStatus(status, '');
    if (mappedStatus) query.status = mappedStatus;
  }

  if (filterField && filterOp && typeof filterValue === 'string' && filterValue.trim()) {
    const allowedFields = new Set([
      'vehicleRegNo', 'ownerName', 'mobileNo', 'panNumber', 'make', 'model', 'vehicleCategory', 'customerType',
      'assignedExecutive', 'status', 'currentDistrict', 'permanentDistrict', 'currentPincode', 'permanentPincode',
      'insuranceCompany', 'insurancePolicyNo', 'leadSource', 'gstin', 'legalName', 'gstTradeName', 'gstContact',
      'gstEmail', 'khananPhone', 'currentFullAddress', 'permanentFullAddress', 'fatherName', 'panAddress',
    ]);
    if (allowedFields.has(filterField)) {
      if (filterField === 'status') {
        const mappedStatus = mapSpringStatusToPipelineStatus(filterValue.trim(), '');
        if (mappedStatus) {
          if (filterOp === 'equals') query.status = mappedStatus;
          else query.status = buildFilterRegex(mappedStatus, filterOp);
        }
      } else {
        query[filterField] = buildFilterRegex(filterValue.trim(), filterOp);
      }
    }
  }

  addDateRange(query, 'createdAt', createdDateFrom, createdDateTo);
  addDateRange(query, 'insuranceDueDate', insuranceDueDateFrom, insuranceDueDateTo);
  addDateRange(query, 'fitnessValidUpto', fitnessValidUptoFrom, fitnessValidUptoTo);
  addDateRange(query, 'pollutionValidUpto', pollutionValidUptoFrom, pollutionValidUptoTo);
  addDateRange(query, 'permitValidUpto', permitValidUptoFrom, permitValidUptoTo);
  addDateRange(query, 'nextFollowUp', nextFollowUpFrom, nextFollowUpTo);

  return query;
}

module.exports = {
  buildVehicleTripSummaryQuery,
};
