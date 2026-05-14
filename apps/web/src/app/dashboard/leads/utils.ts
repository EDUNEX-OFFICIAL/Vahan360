import type { NormalizedVehicle } from './types';
import { SPRING_STATUS_TO_PIPELINE, csvSchemaHeaders } from './constants';

export function classifyVehicle(totalMTWeight: number): NormalizedVehicle['vehicleCategory'] {
  if (totalMTWeight < 500) return '2WN';
  if (totalMTWeight < 3000) return 'LMV';
  if (totalMTWeight < 15000) return 'LGV';
  return 'HGV';
}

export function safeDate(dateValue?: string): Date | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeStatus(
  value?: string,
  fallback: 'pending' | 'in-progress' | 'completed' | '' = 'pending',
): 'pending' | 'in-progress' | 'completed' | '' {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return SPRING_STATUS_TO_PIPELINE[cleaned] || fallback;
}

export function formatStatusLabel(value?: string): string {
  const normalized = normalizeStatus(value, 'pending');
  if (normalized === 'in-progress') return 'In Progress';
  if (normalized === 'completed') return 'Completed';
  return 'Pending';
}

export function toSingleDayRange(date: Date | null): { from: Date; to: Date } | null {
  if (!date) return null;
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function getCsvValue(row: NormalizedVehicle, serial: number, header: string): string {
  const created = row.createdAt || row.updatedAt;
  const dueDate = safeDate(row.insuranceDueDate || row.nextFollowUp);
  const permitDate = safeDate(row.permitValidUpto);
  const fitnessDate = safeDate(row.fitnessValidUpto);
  const pollutionDate = safeDate(row.pollutionValidUpto);
  const mvTaxDate = safeDate(row.mvTaxPaidUpto);
  const dueDateText = dueDate ? dueDate.toLocaleDateString('en-IN') : 'N/A';
  const daysLeft = dueDate ? String(Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 'N/A';
  const permitDaysLeft = permitDate ? String(Math.ceil((permitDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 'N/A';
  const fitnessDaysLeft = fitnessDate ? String(Math.ceil((fitnessDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 'N/A';
  const pollutionDaysLeft = pollutionDate ? String(Math.ceil((pollutionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 'N/A';
  const mvTaxDaysLeft = mvTaxDate ? String(Math.ceil((mvTaxDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 'N/A';
  const makeModel = [row.make, row.model].filter(Boolean).join(' / ');

  const mapping: Record<string, string> = {
    select: '',
    'S.No': String(serial),
    Actions: '...',
    'Vehicle Number': row.vehicleRegNo || 'N/A',
    'Vehicle Category': row.vehicleCategory || 'N/A',
    'Owner Name (full)': row.ownerName || 'N/A',
    "Father's Name": row.fatherName || 'N/A',
    'Current Full Address': row.currentFullAddress || 'N/A',
    'Current Pincode': row.currentPincode || 'N/A',
    'Current District': row.currentDistrict || 'N/A',
    'Permanent Full Address': row.permanentFullAddress || 'N/A',
    'Permanent Pincode': row.permanentPincode || 'N/A',
    'Permanent District': row.permanentDistrict || 'N/A',
    'Insurance Company': row.insuranceCompany,
    'Insurance Policy No.': row.insurancePolicyNo,
    'Ins. Due Date.': dueDateText,
    'GIC Days Left': daysLeft,
    'Manuf. Mon/Yr': row.make || 'N/A',
    'Vehicle Age YY/MM': 'N/A',
    'Vehicle Class': makeModel || 'N/A',
    'GVW (Kgs)': String(row.gvwKgs ?? row.totalMTWeight ?? 0),
    'Customer Type': row.customerType || 'N/A',
    Status: formatStatusLabel(row.status),
    'Leads Agent': row.assignedExecutive || 'N/A',
    Created: created ? new Date(created).toLocaleString('en-IN') : 'N/A',
    'Lead Source': row.leadSource,
    'MV Tax Paid Upto': mvTaxDate ? mvTaxDate.toLocaleDateString('en-IN') : 'N/A',
    'MV Tax Days Left': mvTaxDaysLeft,
    'Permit Valid Upto': permitDate ? permitDate.toLocaleDateString('en-IN') : 'N/A',
    'Permit Days Left': permitDaysLeft,
    Offence: row.offence || 'N/A',
    'Fitness Valid Upto': fitnessDate ? fitnessDate.toLocaleDateString('en-IN') : 'N/A',
    'Fitness Days Left': fitnessDaysLeft,
    'Pollution Valid Upto': pollutionDate ? pollutionDate.toLocaleDateString('en-IN') : 'N/A',
    'Pollution Days Left': pollutionDaysLeft,
    'RC Alternate Mobile No': row.mobileNo || 'N/A',
    'RC PAN No': row.panNumber || 'N/A',
    'PAN Address': row.panAddress || 'N/A',
    'RC GSTIN': row.gstin || 'N/A',
    'RC Legal Name': row.legalName || 'N/A',
    'RC GST Trade Name': row.gstTradeName || 'N/A',
    'RC GST Contact': row.gstContact || 'N/A',
    'RC GST Email': row.gstEmail || 'N/A',
    'Khanan Phone': row.khananPhone || row.mobileNo || 'N/A',
  };

  return mapping[header] ?? 'N/A';
}

export function buildCsvBlob(rows: NormalizedVehicle[]): Blob {
  const headers = [...csvSchemaHeaders];
  const lines = rows.map((row, i) =>
    headers.map((h) => `"${getCsvValue(row, i + 1, h)}"`).join(','),
  );
  return new Blob([[headers.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
}
