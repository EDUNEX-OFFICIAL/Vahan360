'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, clearSpybotToken, getSpybotToken, NO_SPYBOT_JWT_MESSAGE } from '@/lib/api-client';
import { userFacingHttpError } from '@/lib/user-facing-errors';
import type { VehicleStats, VehicleRecord, NormalizedVehicle, LeadFilters, TableFilterState } from './types';
import { initialFilters, tableColumns, cardColorByIndex } from './constants';
import { classifyVehicle, normalizeStatus, toSingleDayRange, safeDate, buildCsvBlob } from './utils';
import { LeadsFilters } from './_components/LeadsFilters';
import { LeadsDataTable } from './_components/LeadsDataTable';

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
    tableColumns.map((col) => col.key),
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
      const token = getSpybotToken();
      if (!token) {
        setError(NO_SPYBOT_JWT_MESSAGE);
        setLoading(false);
        return;
      }

      const statsRes = await apiFetch(`/api/vehicle/stats`, token, { acceptJson: true });
      if (statsRes.ok) {
        const statsData = await statsRes.json() as VehicleStats;
        setStats(statsData);
      } else if (statsRes.status === 401) {
        clearSpybotToken();
        setError(NO_SPYBOT_JWT_MESSAGE);
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
      const addDays = (days: number) => { const d = new Date(now); d.setDate(d.getDate() + days); return d; };

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
          const dr = toSingleDayRange(d);
          if (!dr) return {};
          return { createdDateFrom: dr.from.toISOString(), createdDateTo: dr.to.toISOString() };
        }
        return { filterField: tableFilter.column, filterOp: tableFilter.operator, filterValue: value };
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

      const vehiclesRes = await apiFetch(`/api/vehicle/trip-summary?${params.toString()}`, token, { acceptJson: true });
      if (vehiclesRes.status === 401) {
        clearSpybotToken();
        throw new Error(NO_SPYBOT_JWT_MESSAGE);
      }
      if (!vehiclesRes.ok) {
        const errBody = await vehiclesRes.json().catch(() => ({}));
        throw new Error(userFacingHttpError(vehiclesRes.status, errBody));
      }
      const vehiclesData = await vehiclesRes.json() as { data: VehicleRecord[]; pagination: { pages: number; total: number } };
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
    const timer = setTimeout(() => { void fetchData(); }, 250);
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

  const cardStats = useMemo(() => {
    const ageInDays = (updatedAt: string) =>
      Math.floor((nowMs - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
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
    const token = getSpybotToken();
    if (!token) return;
    setSyncing(true);
    try {
      const res = await apiFetch(`/api/vehicle/sync`, token, { method: 'POST' });
      if (res.ok) void fetchData();
    } catch (syncError) {
      console.error(syncError);
    } finally {
      setSyncing(false);
    }
  };

  const downloadCsv = () => {
    const blob = buildCsvBlob(normalizedVehicles);
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

      {/* ── Page Hero ── */}
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
              onClick={() => void handleSync()}
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

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cardStats.map((card, index) => (
          <div key={card.label} className="rounded-xl border border-spy-border bg-spy-surface-primary p-4">
            <div className={`text-center text-3xl font-semibold ${cardColorByIndex[index] ?? 'text-blue-400'}`}>
              {card.value}
            </div>
            <div className="text-center text-sm text-spy-text-secondary">{card.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <LeadsFilters
        filters={filters}
        updateFilter={updateFilter}
        clearAllFilters={clearAllFilters}
        search={search}
        setSearch={setSearch}
        setCurrentPage={setCurrentPage}
      />

      {/* ── Data Table ── */}
      <LeadsDataTable
        filteredRows={normalizedVehicles}
        visibleColumns={visibleColumns}
        setVisibleColumns={setVisibleColumns}
        selectedRows={selectedRows}
        setSelectedRows={setSelectedRows}
        showColumnsMenu={showColumnsMenu}
        setShowColumnsMenu={setShowColumnsMenu}
        showTableFilterMenu={showTableFilterMenu}
        setShowTableFilterMenu={setShowTableFilterMenu}
        showExportMenu={showExportMenu}
        setShowExportMenu={setShowExportMenu}
        tableSearch={tableSearch}
        setTableSearch={setTableSearch}
        columnsSearch={columnsSearch}
        setColumnsSearch={setColumnsSearch}
        tableFilter={tableFilter}
        setTableFilter={setTableFilter}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        rowsPerPage={rowsPerPage}
        setRowsPerPage={setRowsPerPage}
        totalPages={totalPages}
        totalRecords={totalRecords}
        downloadCsv={downloadCsv}
        showRowActionsFor={showRowActionsFor}
        setShowRowActionsFor={setShowRowActionsFor}
      />

    </div>
  );
}
