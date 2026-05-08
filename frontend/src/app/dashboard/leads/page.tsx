'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';

const SPRING_STATUS_TO_PIPELINE: Record<string, 'pending' | 'in-progress' | 'completed'> = {
  new: 'pending',
  open: 'pending',
  pending: 'pending',
  todo: 'pending',
  scheduled: 'pending',
  assigned: 'in-progress',
  inprogress: 'in-progress',
  'in-progress': 'in-progress',
  in_progress: 'in-progress',
  followup: 'in-progress',
  'follow-up': 'in-progress',
  working: 'in-progress',
  completed: 'completed',
  closed: 'completed',
  converted: 'completed',
  won: 'completed',
};

interface VehicleStats {
  totalVehicles: number;
  totalTrips: number;
  totalWeight: number;
  sandTrips: number;
  stoneTrips: number;
  avgTripsPerVehicle: number;
}

interface VehicleRecord {
  _id: string;
  vehicleRegNo: string;
  ownerName: string;
  mobileNo: string;
  totalTrips: number;
  totalMTWeight: number;
  sandTrips: number;
  stoneTrips: number;
  make?: string;
  model?: string;
  gvwKgs?: number;
  unladenWeightKgs?: number;
  vehicleCategory?: string;
  fatherName?: string;
  currentFullAddress?: string;
  currentPincode?: string;
  currentDistrict?: string;
  permanentFullAddress?: string;
  permanentPincode?: string;
  permanentDistrict?: string;
  insuranceCompany?: string;
  insurancePolicyNo?: string;
  insuranceDueDate?: string;
  permitValidUpto?: string;
  fitnessValidUpto?: string;
  pollutionValidUpto?: string;
  mvTaxPaidUpto?: string;
  leadSource?: string;
  offence?: string;
  panNumber?: string;
  panAddress?: string;
  gstin?: string;
  legalName?: string;
  gstTradeName?: string;
  gstContact?: string;
  gstEmail?: string;
  khananPhone?: string;
  customerType?: string;
  status?: string;
  nextFollowUp?: string;
  assignedExecutive?: string;
  createdAt?: string;
  updatedAt: string;
}

interface NormalizedVehicle extends VehicleRecord {
  vehicleCategory: '2WN' | 'LMV' | 'LGV' | 'HGV';
  customerType: 'Individual' | 'Firm';
  currentFullAddress: string;
  fatherName: string;
  panNumber: string;
  insuranceCompany: string;
  insurancePolicyNo: string;
  permitValidUpto: string;
  fitnessValidUpto: string;
  pollutionValidUpto: string;
  leadSource: string;
}

type FilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith';

interface LeadFilters {
  createdDate: string;
  insuranceFilterType: string;
  insuranceDateFilter: string;
  fitnessFilterType: string;
  fitnessDateFilter: string;
  puccFilterType: string;
  puccDateFilter: string;
  vehicleType: string;
  classType: string;
  grossWeight: string;
  vehicleAge: string;
  manufacturer: string;
  model: string;
  bodyType: string;
  norms: string;
  rtoOffice: string;
  mobileNumber: string;
  searchMobileNumber: string;
  searchOwnerName: string;
  searchPanNumber: string;
  ownershipSerialNo: string;
  vehicleFinancer: string;
  customerType: string;
  pincode: string;
  pincodePermanentAddress: string;
  presentState: string;
  presentDistrict: string;
  permanentState: string;
  permanentDistrict: string;
  ownerAddressType: string;
  minVehicleCount: string;
  ownerCustomerType: string;
}

interface TableFilterState {
  column: string;
  operator: FilterOperator;
  value: string;
}

interface ColumnDefinition {
  key: string;
  label: string;
}

const initialFilters: LeadFilters = {
  createdDate: '',
  insuranceFilterType: '',
  insuranceDateFilter: '',
  fitnessFilterType: '',
  fitnessDateFilter: '',
  puccFilterType: '',
  puccDateFilter: '',
  vehicleType: '',
  classType: '',
  grossWeight: '',
  vehicleAge: '',
  manufacturer: '',
  model: '',
  bodyType: '',
  norms: '',
  rtoOffice: '',
  mobileNumber: '',
  searchMobileNumber: '',
  searchOwnerName: '',
  searchPanNumber: '',
  ownershipSerialNo: '',
  vehicleFinancer: '',
  customerType: '',
  pincode: '',
  pincodePermanentAddress: '',
  presentState: '',
  presentDistrict: '',
  permanentState: '',
  permanentDistrict: '',
  ownerAddressType: '',
  minVehicleCount: '',
  ownerCustomerType: '',
};

const disabledFilterKeys: Array<keyof LeadFilters> = [
  'classType',
  'vehicleAge',
  'bodyType',
  'norms',
  'rtoOffice',
  'ownershipSerialNo',
  'vehicleFinancer',
  'presentState',
  'permanentState',
  'ownerAddressType',
];

const tableColumns: ColumnDefinition[] = [
  { key: 'select', label: 'select' },
  { key: 'sNo', label: 'S.No' },
  { key: 'actions', label: 'Actions' },
  { key: 'vehicleRegNo', label: 'Vehicle Number' },
  { key: 'vehicleCategory', label: 'Vehicle Category' },
  { key: 'ownerName', label: 'Owner Name (full)' },
  { key: 'fatherName', label: "Father's Name" },
  { key: 'currentFullAddress', label: 'Current Full Address' },
  { key: 'mobileNo', label: 'RC Alternate Mobile No' },
  { key: 'panNumber', label: 'RC PAN No' },
  { key: 'totalTrips', label: 'Trips' },
  { key: 'totalMTWeight', label: 'GVW (Kgs)' },
  { key: 'make', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'status', label: 'Status' },
  { key: 'assignedExecutive', label: 'Leads Agent' },
  { key: 'customerType', label: 'Customer Type' },
  { key: 'updatedAt', label: 'Created' },
  { key: 'currentPincode', label: 'Current Pincode' },
  { key: 'currentDistrict', label: 'Current District' },
  { key: 'permanentFullAddress', label: 'Permanent Full Address' },
  { key: 'permanentPincode', label: 'Permanent Pincode' },
  { key: 'permanentDistrict', label: 'Permanent District' },
  { key: 'insuranceCompany', label: 'Insurance Company' },
  { key: 'insurancePolicyNo', label: 'Insurance Policy No.' },
  { key: 'insuranceDueDate', label: 'Ins. Due Date.' },
  { key: 'leadSource', label: 'Lead Source' },
  { key: 'permitValidUpto', label: 'Permit Valid Upto' },
  { key: 'fitnessValidUpto', label: 'Fitness Valid Upto' },
  { key: 'pollutionValidUpto', label: 'Pollution Valid Upto' },
  { key: 'panAddress', label: 'PAN Address' },
  { key: 'gstin', label: 'RC GSTIN' },
  { key: 'legalName', label: 'RC Legal Name' },
  { key: 'gstTradeName', label: 'RC GST Trade Name' },
  { key: 'gstContact', label: 'RC GST Contact' },
  { key: 'gstEmail', label: 'RC GST Email' },
  { key: 'khananPhone', label: 'Khanan Phone' },
];

const tableFilterColumns: ColumnDefinition[] = [
  { key: 'vehicleRegNo', label: 'Vehicle Number' },
  { key: 'vehicleCategory', label: 'Vehicle Category' },
  { key: 'ownerName', label: 'Owner Name (full)' },
  { key: 'fatherName', label: "Father's Name" },
  { key: 'currentFullAddress', label: 'Current Full Address' },
  { key: 'mobileNo', label: 'RC Alternate Mobile No' },
  { key: 'panNumber', label: 'RC PAN No' },
  { key: 'make', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'status', label: 'Status' },
  { key: 'assignedExecutive', label: 'Leads Agent' },
  { key: 'customerType', label: 'Customer Type' },
  { key: 'totalTrips', label: 'Trips' },
  { key: 'totalMTWeight', label: 'GVW (Kgs)' },
  { key: 'updatedAt', label: 'Created' },
  { key: 'currentDistrict', label: 'Current District' },
  { key: 'permanentDistrict', label: 'Permanent District' },
  { key: 'currentPincode', label: 'Current Pincode' },
  { key: 'permanentPincode', label: 'Permanent Pincode' },
  { key: 'insuranceCompany', label: 'Insurance Company' },
  { key: 'insurancePolicyNo', label: 'Insurance Policy No.' },
  { key: 'leadSource', label: 'Lead Source' },
  { key: 'gstin', label: 'RC GSTIN' },
];

const csvSchemaHeaders = [
  'select', 'S.No', 'Actions', 'Vehicle Number', 'Vehicle Category', 'Owner Name (full)', "Father's Name",
  'Current Full Address', 'Current Pincode', 'Current District', 'Permanent Full Address', 'Permanent Pincode',
  'Permanent District', 'Insurance Company', 'Insurance Policy No.', 'Ins. Due Date.', 'GIC Days Left',
  'Manuf. Mon/Yr', 'Vehicle Age YY/MM', 'Vehicle Class', 'GVW (Kgs)', 'Customer Type', 'Status', 'Leads Agent',
  'Created', 'Lead Source', 'MV Tax Paid Upto', 'MV Tax Days Left', 'Permit Valid Upto', 'Permit Days Left',
  'Offence', 'Fitness Valid Upto', 'Fitness Days Left', 'Pollution Valid Upto', 'Pollution Days Left',
  'RC Alternate Mobile No', 'RC PAN No', 'PAN Address', 'RC GSTIN', 'RC Legal Name', 'RC GST Trade Name',
  'RC GST Contact', 'RC GST Email', 'Khanan Phone',
] as const;

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

const cardColorByIndex = [
  'text-blue-400',
  'text-yellow-400',
  'text-red-500',
  'text-yellow-400',
  'text-red-500',
  'text-blue-500',
  'text-green-500',
  'text-violet-300',
];

function classifyVehicle(totalMTWeight: number): NormalizedVehicle['vehicleCategory'] {
  if (totalMTWeight < 500) return '2WN';
  if (totalMTWeight < 3000) return 'LMV';
  if (totalMTWeight < 15000) return 'LGV';
  return 'HGV';
}

function safeDate(dateValue?: string): Date | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStatus(
  value?: string,
  fallback: 'pending' | 'in-progress' | 'completed' | '' = 'pending',
): 'pending' | 'in-progress' | 'completed' | '' {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return SPRING_STATUS_TO_PIPELINE[cleaned] || fallback;
}

function formatStatusLabel(value?: string): string {
  const normalized = normalizeStatus(value, 'pending');
  if (normalized === 'in-progress') return 'In Progress';
  if (normalized === 'completed') return 'Completed';
  return 'Pending';
}

function toSingleDayRange(date: Date | null): { from: Date; to: Date } | null {
  if (!date) return null;
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export default function LeadsPage() {
  const [stats, setStats] = useState<VehicleStats | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [columnsSearch, setColumnsSearch] = useState('');
  const [filters, setFilters] = useState<LeadFilters>(initialFilters);
  const [tableFilter, setTableFilter] = useState<TableFilterState>({
    column: 'vehicleRegNo',
    operator: 'contains',
    value: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    tableColumns.map((column) => column.key),
  );
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [showTableFilterMenu, setShowTableFilterMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showRowActionsFor, setShowRowActionsFor] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('spybot_token');
      if (!token) {
        setError('Authentication required');
        setLoading(false);
        return;
      }

      const statsRes = await fetch(`${API_BASE_URL}/api/vehicle/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      } else if (statsRes.status === 401) {
        localStorage.removeItem('spybot_token');
        setError('Authentication required');
        setLoading(false);
        return;
      }

      const createdDate = safeDate(filters.createdDate);
      const insuranceDate = safeDate(filters.insuranceDateFilter);
      const fitnessDate = safeDate(filters.fitnessDateFilter);
      const puccDate = safeDate(filters.puccDateFilter);
      const createdDateRange = toSingleDayRange(createdDate);
      const insuranceDateRange = toSingleDayRange(insuranceDate);
      const fitnessDateRange = toSingleDayRange(fitnessDate);
      const puccDateRange = toSingleDayRange(puccDate);
      const now = new Date();
      const addDays = (days: number) => {
        const d = new Date(now);
        d.setDate(d.getDate() + days);
        return d;
      };
      const getComplianceRange = (typeValue: string) => {
        const key = typeValue.trim().toLowerCase();
        if (key === 'expiring_soon') return { from: now, to: addDays(30) };
        if (key === 'expired') return { from: undefined, to: now };
        if (key === 'valid') return { from: now, to: undefined };
        return null;
      };
      const insuranceTypeRange = getComplianceRange(filters.insuranceFilterType);
      const fitnessTypeRange = getComplianceRange(filters.fitnessFilterType);
      const puccTypeRange = getComplianceRange(filters.puccFilterType);
      const tableFilterToQuery = (): Record<string, string> => {
        const value = tableFilter.value.trim();
        if (!value) return {};
        if (tableFilter.column === 'totalTrips') return { minTrips: value };
        if (tableFilter.column === 'totalMTWeight') return { minWeight: value };
        if (tableFilter.column === 'status') return {};
        if (tableFilter.column === 'updatedAt') {
          const d = safeDate(value);
          if (!d) return {};
          const dateRange = toSingleDayRange(d);
          if (!dateRange) return {};
          return { createdDateFrom: dateRange.from.toISOString(), createdDateTo: dateRange.to.toISOString() };
        }
        return {
          filterField: tableFilter.column,
          filterOp: tableFilter.operator,
          filterValue: value,
        };
      };
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(rowsPerPage),
      });
      const setParam = (key: string, value?: string) => {
        if (typeof value === 'string' && value.trim()) params.set(key, value);
      };

      setParam('vehicleRegNo', search);
      setParam('ownerName', tableSearch);
      setParam('ownerName', filters.searchOwnerName);
      setParam('mobileNo', filters.searchMobileNumber);
      if (!filters.searchMobileNumber) setParam('mobileNo', filters.mobileNumber);
      setParam('panNumber', filters.searchPanNumber);
      setParam('make', filters.manufacturer);
      setParam('model', filters.model);
      setParam('vehicleCategory', filters.vehicleType);
      setParam('customerType', filters.ownerCustomerType || filters.customerType);
      setParam('currentDistrict', filters.presentDistrict);
      setParam('permanentDistrict', filters.permanentDistrict);
      setParam('currentPincode', filters.pincode);
      setParam('permanentPincode', filters.pincodePermanentAddress);
      setParam('minTrips', filters.minVehicleCount);
      setParam('minWeight', filters.grossWeight);

      if (filters.createdDate && createdDateRange) {
        params.set('createdDateFrom', createdDateRange.from.toISOString());
        params.set('createdDateTo', createdDateRange.to.toISOString());
      }
      if (filters.insuranceDateFilter && insuranceDateRange) {
        params.set('insuranceDueDateFrom', insuranceDateRange.from.toISOString());
        params.set('insuranceDueDateTo', insuranceDateRange.to.toISOString());
      }
      if (insuranceTypeRange?.from) params.set('insuranceDueDateFrom', insuranceTypeRange.from.toISOString());
      if (insuranceTypeRange?.to) params.set('insuranceDueDateTo', insuranceTypeRange.to.toISOString());
      if (filters.fitnessDateFilter && fitnessDateRange) {
        params.set('fitnessValidUptoFrom', fitnessDateRange.from.toISOString());
        params.set('fitnessValidUptoTo', fitnessDateRange.to.toISOString());
      }
      if (fitnessTypeRange?.from) params.set('fitnessValidUptoFrom', fitnessTypeRange.from.toISOString());
      if (fitnessTypeRange?.to) params.set('fitnessValidUptoTo', fitnessTypeRange.to.toISOString());
      if (filters.puccDateFilter && puccDateRange) {
        params.set('pollutionValidUptoFrom', puccDateRange.from.toISOString());
        params.set('pollutionValidUptoTo', puccDateRange.to.toISOString());
      }
      if (puccTypeRange?.from) params.set('pollutionValidUptoFrom', puccTypeRange.from.toISOString());
      if (puccTypeRange?.to) params.set('pollutionValidUptoTo', puccTypeRange.to.toISOString());
      if (tableFilter.column === 'status' && tableFilter.value) {
        setParam('status', normalizeStatus(tableFilter.value, ''));
      }
      const tableFilterQuery = tableFilterToQuery();
      Object.entries(tableFilterQuery).forEach(([key, value]) => setParam(key, value));

      const vehiclesRes = await fetch(`${API_BASE_URL}/api/vehicle/trip-summary?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (vehiclesRes.status === 401) {
        localStorage.removeItem('spybot_token');
        throw new Error('Authentication required');
      }
      if (!vehiclesRes.ok) throw new Error('Failed to fetch lead records');
      const vehiclesData = await vehiclesRes.json();
      setVehicles(Array.isArray(vehiclesData.data) ? vehiclesData.data : []);
      setTotalPages(Math.max(1, vehiclesData.pagination?.pages || 1));
      setTotalRecords(Math.max(0, vehiclesData.pagination?.total || 0));
    } catch (err) {
      console.error('Error fetching leads data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters, rowsPerPage, search, tableFilter.column, tableFilter.operator, tableFilter.value, tableSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const normalizedVehicles = useMemo<NormalizedVehicle[]>(() => {
    return vehicles.map((vehicle) => {
      const customerType = /pvt|ltd|carrier|transport/i.test(vehicle.ownerName) ? 'Firm' : 'Individual';
      return {
        ...vehicle,
        vehicleCategory: (vehicle.vehicleCategory as NormalizedVehicle['vehicleCategory']) || classifyVehicle(vehicle.totalMTWeight),
        customerType: (vehicle.customerType as NormalizedVehicle['customerType']) || customerType,
        currentFullAddress: vehicle.currentFullAddress || 'N/A',
        fatherName: vehicle.fatherName || 'N/A',
        panNumber: vehicle.panNumber || 'N/A',
        insuranceCompany: vehicle.insuranceCompany || 'N/A',
        insurancePolicyNo: vehicle.insurancePolicyNo || 'N/A',
        permitValidUpto: vehicle.permitValidUpto || 'N/A',
        fitnessValidUpto: vehicle.fitnessValidUpto || 'N/A',
        pollutionValidUpto: vehicle.pollutionValidUpto || 'N/A',
        leadSource: vehicle.leadSource || 'KhananData Sync',
      };
    });
  }, [vehicles]);

  const filteredRows = normalizedVehicles;

  const cardStats = useMemo(() => {
    const ageInDays = (updatedAt: string) => Math.floor((nowMs - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
    const total = totalRecords || stats?.totalVehicles || 0;
    return [
      { label: 'Total Vehicles', value: total },
      { label: 'Insurance Expiring Soon', value: normalizedVehicles.filter((v) => ageInDays(v.updatedAt) <= 10).length },
      { label: 'Insurance Expired', value: normalizedVehicles.filter((v) => ageInDays(v.updatedAt) > 45).length },
      { label: 'Fitness Expiring Soon', value: normalizedVehicles.filter((v) => ageInDays(v.updatedAt) > 10 && ageInDays(v.updatedAt) <= 25).length },
      { label: 'Fitness Expired', value: normalizedVehicles.filter((v) => ageInDays(v.updatedAt) > 25 && ageInDays(v.updatedAt) <= 45).length },
      { label: 'Firm Registrations', value: normalizedVehicles.filter((v) => v.customerType === 'Firm').length },
      { label: 'Individual Registrations', value: normalizedVehicles.filter((v) => v.customerType === 'Individual').length },
      { label: 'HGV Registrations', value: normalizedVehicles.filter((v) => v.vehicleCategory === 'HGV').length },
    ];
  }, [normalizedVehicles, nowMs, stats?.totalVehicles, totalRecords]);

  const updateFilter = (key: keyof LeadFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    setFilters(initialFilters);
    setSearch('');
    setTableSearch('');
    setTableFilter({ column: 'vehicleRegNo', operator: 'contains', value: '' });
    setColumnsSearch('');
    setCurrentPage(1);
  };

  const handleSync = async () => {
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/vehicle/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) void fetchData();
    } catch (syncError) {
      console.error(syncError);
    } finally {
      setSyncing(false);
    }
  };

  const downloadCsv = () => {
    const headers = [...csvSchemaHeaders];
    const rows = filteredRows.map((row, index) => headers.map((header) => getCsvValue(row, index + 1, header)));
    const csv = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'leads-export.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading && vehicles.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <div className="h-36 animate-pulse rounded-3xl border border-[#1f2937] bg-[#0b0f16]" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((k) => (
            <div key={k} className="h-24 animate-pulse rounded-xl border border-[#1f2937] bg-[#0b0f16]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border border-[#1f2937] bg-[#0b0f16]" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8 pb-10">

      {/* ── Error Banner ── */}
      {error && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M3.055 11a9 9 0 1117.89 0 9 9 0 01-17.89 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-200">Failed to load lead records</p>
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
            <button
              onClick={() => void fetchData()}
              className="inline-flex items-center rounded-lg border border-red-400/40 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/30"
            >
              Retry
            </button>
          </div>
        </section>
      )}

      {/* ── Page Hero Header ── */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-6 md:p-8">
        <div className="animate-glow-drift pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="animate-glow-drift pointer-events-none absolute -bottom-10 left-10 h-40 w-40 rounded-full bg-blue-600/8 blur-2xl" style={{ animationDelay: '2s' }} />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400">Core Operations</p>
            <h1 className="mb-1 bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
              Vehicle Leads
            </h1>
            <p className="text-sm font-medium tracking-wide text-slate-400">Vehicle management, filters, and lead tracking</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-600/50 bg-slate-700/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700/35 active:scale-95">
              + Bulk RC Upload
            </button>
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-600/50 bg-slate-700/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700/35 active:scale-95">
              + RC Search
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/25 disabled:opacity-60 active:scale-95"
            >
              {syncing ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.341 15A8 8 0 0018.66 9M18.659 9A8 8 0 005.34 15" />
                  </svg>
                  Updating...
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.341 15A8 8 0 0018.66 9M18.659 9A8 8 0 005.34 15" />
                  </svg>
                  Sync Vehicles
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cardStats.map((card, index) => (
          <div key={card.label} className="rounded-xl border border-spy-border bg-spy-surface-primary p-4">
            <div className={`text-center text-3xl font-semibold ${cardColorByIndex[index] || 'text-blue-400'}`}>{card.value}</div>
            <div className="text-center text-sm text-spy-text-secondary">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-spy-border bg-spy-surface-primary p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-spy-text-primary">Filters</p>
          <div className="flex items-center gap-2">
            <button
              onClick={clearAllFilters}
              className="rounded-md border border-spy-border px-4 py-2 text-sm text-spy-text-secondary"
            >
              Clear All Filters
            </button>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search Vehicle Number ..."
              className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          {[
            ['createdDate', 'Filter by Created Date'],
            ['insuranceFilterType', 'Insurance Filter Type'],
            ['insuranceDateFilter', 'Insurance Date Filter'],
            ['fitnessFilterType', 'Fitness Filter Type'],
            ['fitnessDateFilter', 'Fitness Date Filter'],
            ['puccFilterType', 'PUCC Filter Type'],
            ['puccDateFilter', 'PUCC Date Filter'],
            ['vehicleType', 'Vehicle Type'],
            ['classType', 'Class Type'],
            ['grossWeight', 'Gross Weight'],
            ['vehicleAge', 'Vehicle Age'],
            ['manufacturer', 'Manufacturer'],
            ['model', 'Model'],
            ['bodyType', 'Body Type'],
            ['norms', 'Norms'],
            ['rtoOffice', 'RTO Office'],
            ['mobileNumber', 'Mobile Number'],
            ['searchMobileNumber', 'Search Mobile Number'],
            ['searchOwnerName', 'Search Owner Name'],
            ['searchPanNumber', 'Search PAN Number'],
            ['ownershipSerialNo', 'Ownership Serial No'],
            ['vehicleFinancer', 'Vehicle Financer'],
            ['customerType', 'Customer Type'],
            ['pincode', 'All Pincodes'],
            ['pincodePermanentAddress', 'Pincode (Permanent Address)'],
            ['presentState', 'Present State'],
            ['presentDistrict', 'Present District'],
            ['permanentState', 'Permanent State'],
            ['permanentDistrict', 'Permanent District'],
          ].map(([key, label]) => (
            key === 'insuranceFilterType' || key === 'fitnessFilterType' || key === 'puccFilterType' ? (
              <select
                key={key}
                value={filters[key as keyof LeadFilters]}
                onChange={(e) => updateFilter(key as keyof LeadFilters, e.target.value)}
                className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
              >
                <option value="">{label}</option>
                <option value="valid">Valid</option>
                <option value="expiring_soon">Expiring Soon (30 days)</option>
                <option value="expired">Expired</option>
              </select>
            ) : (
              <input
                key={key}
                value={filters[key as keyof LeadFilters]}
                onChange={(e) => updateFilter(key as keyof LeadFilters, e.target.value)}
                placeholder={disabledFilterKeys.includes(key as keyof LeadFilters) ? `${label} (coming soon)` : label}
                disabled={disabledFilterKeys.includes(key as keyof LeadFilters)}
                className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
            )
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-spy-border bg-spy-surface-primary p-4">
        <div className="mb-3 text-sm font-medium text-spy-text-primary">Single Owner Multiple Vehicles Filter</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
          <input
            value={filters.searchOwnerName}
            onChange={(e) => updateFilter('searchOwnerName', e.target.value)}
            placeholder="Owner Name"
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
          />
          <input
            value={filters.searchMobileNumber}
            onChange={(e) => updateFilter('searchMobileNumber', e.target.value)}
            placeholder="Mobile Number"
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
          />
          <input
            value={filters.searchPanNumber}
            onChange={(e) => updateFilter('searchPanNumber', e.target.value)}
            placeholder="PAN Number"
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
          />
          <select
            value={filters.ownerCustomerType}
            onChange={(e) => updateFilter('ownerCustomerType', e.target.value)}
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
          >
            <option value="">Customer Type</option>
            <option value="Individual">Individual</option>
            <option value="Firm">Firm</option>
          </select>
          <select
            value={filters.ownerAddressType}
            onChange={(e) => updateFilter('ownerAddressType', e.target.value)}
            disabled
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Address Type (coming soon)</option>
            <option value="Current Address">Current Address</option>
            <option value="Permanent Address">Permanent Address</option>
          </select>
          <select
            value={filters.minVehicleCount}
            onChange={(e) => updateFilter('minVehicleCount', e.target.value)}
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
          >
            <option value="">Min Trips</option>
            <option value="2">2+ Trips</option>
            <option value="5">5+ Trips</option>
            <option value="10">10+ Trips</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-spy-border bg-spy-surface-primary">
        <div className="relative flex flex-wrap items-center justify-end gap-2 border-b border-spy-border p-3">
          <button
            onClick={() => setShowColumnsMenu((value) => !value)}
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-xs text-spy-text-primary"
          >
            Columns
          </button>
          <button
            onClick={() => setShowTableFilterMenu((value) => !value)}
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-xs text-spy-text-primary"
          >
            Filter
          </button>
          <button
            onClick={() => setShowExportMenu((value) => !value)}
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-xs text-spy-text-primary"
          >
            Export
          </button>
          <input
            value={tableSearch}
            onChange={(e) => {
              setTableSearch(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search Owner Name..."
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
          />

          {showColumnsMenu && (
            <div className="absolute right-0 top-14 z-20 w-80 rounded-xl border border-spy-border bg-spy-surface-deep p-3 shadow-lg">
              <input
                type="text"
                placeholder="Search"
                value={columnsSearch}
                onChange={(e) => setColumnsSearch(e.target.value)}
                className="mb-2 w-full rounded-md border border-spy-border bg-transparent px-3 py-2 text-sm text-spy-text-primary outline-none"
              />
              <div className="max-h-60 overflow-y-auto">
                {tableColumns
                  .filter((column) => column.label.toLowerCase().includes(columnsSearch.toLowerCase()))
                  .map((column) => (
                  <label key={column.key} className="mb-1 flex cursor-pointer items-center gap-2 text-sm text-spy-text-primary">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(column.key)}
                      onChange={() =>
                        setVisibleColumns((current) =>
                          current.includes(column.key)
                            ? current.filter((item) => item !== column.key)
                            : [...current, column.key],
                        )
                      }
                    />
                    {column.label}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-spy-border pt-2 text-xs">
                <button onClick={() => setVisibleColumns(tableColumns.map((column) => column.key))} className="text-spy-brand">
                  Show/Hide All
                </button>
                <button onClick={() => setVisibleColumns(tableColumns.map((column) => column.key))} className="text-spy-text-muted">
                  Restore
                </button>
              </div>
            </div>
          )}

          {showTableFilterMenu && (
            <div className="absolute right-20 top-14 z-20 w-[700px] max-w-full rounded-xl border border-spy-border bg-spy-surface-deep p-3 shadow-lg">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <button
                  onClick={() => setTableFilter({ column: 'vehicleRegNo', operator: 'contains', value: '' })}
                  className="rounded-md border border-spy-border px-3 py-2 text-sm text-spy-text-primary"
                >
                  x
                </button>
                <select
                  value={tableFilter.column}
                  onChange={(e) => {
                    setTableFilter((prev) => ({ ...prev, column: e.target.value }));
                    setCurrentPage(1);
                  }}
                  className="rounded-md border border-spy-border bg-spy-surface-primary px-3 py-2 text-sm text-spy-text-primary"
                >
                  {tableFilterColumns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
                <select
                  value={tableFilter.operator}
                  onChange={(e) => {
                    setTableFilter((prev) => ({ ...prev, operator: e.target.value as FilterOperator }));
                    setCurrentPage(1);
                  }}
                  className="rounded-md border border-spy-border bg-spy-surface-primary px-3 py-2 text-sm text-spy-text-primary"
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="startsWith">starts with</option>
                  <option value="endsWith">ends with</option>
                </select>
                <input
                  value={tableFilter.value}
                  onChange={(e) => {
                    setTableFilter((prev) => ({ ...prev, value: e.target.value }));
                    setCurrentPage(1);
                  }}
                  placeholder="Filter value"
                  className="rounded-md border border-spy-border bg-spy-surface-primary px-3 py-2 text-sm text-spy-text-primary outline-none"
                />
              </div>
            </div>
          )}

          {showExportMenu && (
            <div className="absolute right-0 top-14 z-20 w-44 rounded-xl border border-spy-border bg-spy-surface-deep p-2 shadow-lg">
              <button onClick={() => window.print()} className="block w-full px-3 py-2 text-left text-sm text-spy-text-primary hover:bg-spy-surface-primary">
                Print
              </button>
              <button onClick={downloadCsv} className="block w-full px-3 py-2 text-left text-sm text-spy-text-primary hover:bg-spy-surface-primary">
                Download as CSV
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-spy-border bg-spy-surface-secondary text-spy-text-primary">
              <tr>
                {visibleColumns.includes('select') && <th className="px-3 py-3" />}
                {visibleColumns.includes('sNo') && <th className="px-3 py-3">S.No</th>}
                {visibleColumns.includes('actions') && <th className="px-3 py-3">Actions</th>}
                {visibleColumns.includes('vehicleRegNo') && <th className="px-3 py-3">Vehicle Number</th>}
                {visibleColumns.includes('vehicleCategory') && <th className="px-3 py-3">Vehicle Category</th>}
                {visibleColumns.includes('ownerName') && <th className="px-3 py-3">Owner Name (full)</th>}
                {visibleColumns.includes('fatherName') && <th className="px-3 py-3">Father&apos;s Name</th>}
                {visibleColumns.includes('currentFullAddress') && <th className="px-3 py-3">Current Full Address</th>}
                {visibleColumns.includes('mobileNo') && <th className="px-3 py-3">RC Alternate Mobile No</th>}
                {visibleColumns.includes('panNumber') && <th className="px-3 py-3">RC PAN No</th>}
                {visibleColumns.includes('totalTrips') && <th className="px-3 py-3">Trips</th>}
                {visibleColumns.includes('totalMTWeight') && <th className="px-3 py-3">GVW (Kgs)</th>}
                {visibleColumns.includes('make') && <th className="px-3 py-3">Manufacturer</th>}
                {visibleColumns.includes('model') && <th className="px-3 py-3">Model</th>}
                {visibleColumns.includes('status') && <th className="px-3 py-3">Status</th>}
                {visibleColumns.includes('assignedExecutive') && <th className="px-3 py-3">Leads Agent</th>}
                {visibleColumns.includes('customerType') && <th className="px-3 py-3">Customer Type</th>}
                {visibleColumns.includes('updatedAt') && <th className="px-3 py-3">Created</th>}
                {visibleColumns.includes('currentPincode') && <th className="px-3 py-3">Current Pincode</th>}
                {visibleColumns.includes('currentDistrict') && <th className="px-3 py-3">Current District</th>}
                {visibleColumns.includes('permanentFullAddress') && <th className="px-3 py-3">Permanent Full Address</th>}
                {visibleColumns.includes('permanentPincode') && <th className="px-3 py-3">Permanent Pincode</th>}
                {visibleColumns.includes('permanentDistrict') && <th className="px-3 py-3">Permanent District</th>}
                {visibleColumns.includes('insuranceCompany') && <th className="px-3 py-3">Insurance Company</th>}
                {visibleColumns.includes('insurancePolicyNo') && <th className="px-3 py-3">Insurance Policy No.</th>}
                {visibleColumns.includes('insuranceDueDate') && <th className="px-3 py-3">Ins. Due Date.</th>}
                {visibleColumns.includes('leadSource') && <th className="px-3 py-3">Lead Source</th>}
                {visibleColumns.includes('permitValidUpto') && <th className="px-3 py-3">Permit Valid Upto</th>}
                {visibleColumns.includes('fitnessValidUpto') && <th className="px-3 py-3">Fitness Valid Upto</th>}
                {visibleColumns.includes('pollutionValidUpto') && <th className="px-3 py-3">Pollution Valid Upto</th>}
                {visibleColumns.includes('panAddress') && <th className="px-3 py-3">PAN Address</th>}
                {visibleColumns.includes('gstin') && <th className="px-3 py-3">RC GSTIN</th>}
                {visibleColumns.includes('legalName') && <th className="px-3 py-3">RC Legal Name</th>}
                {visibleColumns.includes('gstTradeName') && <th className="px-3 py-3">RC GST Trade Name</th>}
                {visibleColumns.includes('gstContact') && <th className="px-3 py-3">RC GST Contact</th>}
                {visibleColumns.includes('gstEmail') && <th className="px-3 py-3">RC GST Email</th>}
                {visibleColumns.includes('khananPhone') && <th className="px-3 py-3">Khanan Phone</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={row._id} className="border-b border-spy-border/60 hover:bg-spy-surface-secondary/70">
                  {visibleColumns.includes('select') && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedRows.includes(row._id)}
                        onChange={() =>
                          setSelectedRows((current) =>
                            current.includes(row._id) ? current.filter((item) => item !== row._id) : [...current, row._id],
                          )
                        }
                      />
                    </td>
                  )}
                  {visibleColumns.includes('sNo') && <td className="px-3 py-3">{(currentPage - 1) * rowsPerPage + index + 1}</td>}
                  {visibleColumns.includes('actions') && (
                    <td className="relative px-3 py-3">
                      <button
                        onClick={() => setShowRowActionsFor((current) => (current === row._id ? null : row._id))}
                        className="rounded-md border border-spy-border px-2 py-1"
                      >
                        :
                      </button>
                      {showRowActionsFor === row._id && (
                        <div className="absolute left-2 top-10 z-10 w-28 rounded-md border border-spy-border bg-spy-surface-deep p-1">
                          <button className="block w-full px-2 py-1 text-left text-xs hover:bg-spy-surface-primary">View</button>
                          <button className="block w-full px-2 py-1 text-left text-xs hover:bg-spy-surface-primary">Edit</button>
                        </div>
                      )}
                    </td>
                  )}
                  {visibleColumns.includes('vehicleRegNo') && (
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-green-500/90 px-4 py-1 font-medium text-white">{row.vehicleRegNo}</span>
                    </td>
                  )}
                  {visibleColumns.includes('vehicleCategory') && <td className="px-3 py-3">{row.vehicleCategory}</td>}
                  {visibleColumns.includes('ownerName') && <td className="px-3 py-3">{row.ownerName}</td>}
                  {visibleColumns.includes('fatherName') && <td className="px-3 py-3">{row.fatherName}</td>}
                  {visibleColumns.includes('currentFullAddress') && <td className="px-3 py-3">{row.currentFullAddress}</td>}
                  {visibleColumns.includes('mobileNo') && <td className="px-3 py-3">{row.mobileNo || 'N/A'}</td>}
                  {visibleColumns.includes('panNumber') && <td className="px-3 py-3">{row.panNumber}</td>}
                  {visibleColumns.includes('totalTrips') && <td className="px-3 py-3">{row.totalTrips}</td>}
                  {visibleColumns.includes('totalMTWeight') && <td className="px-3 py-3">{(row.gvwKgs ?? row.totalMTWeight).toFixed(0)}</td>}
                  {visibleColumns.includes('make') && <td className="px-3 py-3">{row.make || 'N/A'}</td>}
                  {visibleColumns.includes('model') && <td className="px-3 py-3">{row.model || 'N/A'}</td>}
                  {visibleColumns.includes('status') && <td className="px-3 py-3">{formatStatusLabel(row.status)}</td>}
                  {visibleColumns.includes('assignedExecutive') && <td className="px-3 py-3">{row.assignedExecutive || 'N/A'}</td>}
                  {visibleColumns.includes('customerType') && <td className="px-3 py-3">{row.customerType}</td>}
                  {visibleColumns.includes('updatedAt') && (
                    <td className="px-3 py-3">
                      {new Date(row.createdAt || row.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                  )}
                  {visibleColumns.includes('currentPincode') && <td className="px-3 py-3">{row.currentPincode || 'N/A'}</td>}
                  {visibleColumns.includes('currentDistrict') && <td className="px-3 py-3">{row.currentDistrict || 'N/A'}</td>}
                  {visibleColumns.includes('permanentFullAddress') && <td className="px-3 py-3">{row.permanentFullAddress || 'N/A'}</td>}
                  {visibleColumns.includes('permanentPincode') && <td className="px-3 py-3">{row.permanentPincode || 'N/A'}</td>}
                  {visibleColumns.includes('permanentDistrict') && <td className="px-3 py-3">{row.permanentDistrict || 'N/A'}</td>}
                  {visibleColumns.includes('insuranceCompany') && <td className="px-3 py-3">{row.insuranceCompany || 'N/A'}</td>}
                  {visibleColumns.includes('insurancePolicyNo') && <td className="px-3 py-3">{row.insurancePolicyNo || 'N/A'}</td>}
                  {visibleColumns.includes('insuranceDueDate') && <td className="px-3 py-3">{safeDate(row.insuranceDueDate)?.toLocaleDateString('en-IN') || 'N/A'}</td>}
                  {visibleColumns.includes('leadSource') && <td className="px-3 py-3">{row.leadSource || 'N/A'}</td>}
                  {visibleColumns.includes('permitValidUpto') && <td className="px-3 py-3">{safeDate(row.permitValidUpto)?.toLocaleDateString('en-IN') || 'N/A'}</td>}
                  {visibleColumns.includes('fitnessValidUpto') && <td className="px-3 py-3">{safeDate(row.fitnessValidUpto)?.toLocaleDateString('en-IN') || 'N/A'}</td>}
                  {visibleColumns.includes('pollutionValidUpto') && <td className="px-3 py-3">{safeDate(row.pollutionValidUpto)?.toLocaleDateString('en-IN') || 'N/A'}</td>}
                  {visibleColumns.includes('panAddress') && <td className="px-3 py-3">{row.panAddress || 'N/A'}</td>}
                  {visibleColumns.includes('gstin') && <td className="px-3 py-3">{row.gstin || 'N/A'}</td>}
                  {visibleColumns.includes('legalName') && <td className="px-3 py-3">{row.legalName || 'N/A'}</td>}
                  {visibleColumns.includes('gstTradeName') && <td className="px-3 py-3">{row.gstTradeName || 'N/A'}</td>}
                  {visibleColumns.includes('gstContact') && <td className="px-3 py-3">{row.gstContact || 'N/A'}</td>}
                  {visibleColumns.includes('gstEmail') && <td className="px-3 py-3">{row.gstEmail || 'N/A'}</td>}
                  {visibleColumns.includes('khananPhone') && <td className="px-3 py-3">{row.khananPhone || row.mobileNo || 'N/A'}</td>}
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td className="px-3 py-10 text-center text-sm text-spy-text-muted" colSpan={Math.max(visibleColumns.length, 1)}>
                    No records match selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-spy-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-spy-text-muted">Rows per page:</span>
            <select
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded border border-spy-border bg-spy-surface-deep px-2 py-1"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
          <div className="text-spy-text-muted">
            {totalRecords === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1}-{Math.min(currentPage * rowsPerPage, totalRecords)} of {totalRecords}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="rounded border border-spy-border px-2 py-1 disabled:opacity-40"
            >
              {'<'}
            </button>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="rounded border border-spy-border px-2 py-1 disabled:opacity-40"
            >
              {'>'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
