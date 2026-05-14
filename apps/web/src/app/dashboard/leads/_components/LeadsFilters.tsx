'use client';

import type { LeadFilters } from '../types';
import { disabledFilterKeys } from '../constants';

interface LeadsFiltersProps {
  filters: LeadFilters;
  updateFilter: (key: keyof LeadFilters, value: string) => void;
  clearAllFilters: () => void;
  search: string;
  setSearch: (v: string) => void;
  setCurrentPage: (page: number) => void;
}

export function LeadsFilters({
  filters,
  updateFilter,
  clearAllFilters,
  search,
  setSearch,
  setCurrentPage,
}: LeadsFiltersProps) {
  return (
    <>
      {/* ── Main filter grid ── */}
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
          {([
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
          ] as [string, string][]).map(([key, label]) =>
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
            ),
          )}
        </div>
      </div>

      {/* ── Single owner / multi-vehicle filter ── */}
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
    </>
  );
}
