'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { NormalizedVehicle, TableFilterState, FilterOperator } from '../types';
import { tableColumns, tableFilterColumns } from '../constants';
import { safeDate, formatStatusLabel } from '../utils';

interface LeadsDataTableProps {
  filteredRows: NormalizedVehicle[];
  visibleColumns: string[];
  setVisibleColumns: Dispatch<SetStateAction<string[]>>;
  selectedRows: string[];
  setSelectedRows: Dispatch<SetStateAction<string[]>>;
  showColumnsMenu: boolean;
  setShowColumnsMenu: Dispatch<SetStateAction<boolean>>;
  showTableFilterMenu: boolean;
  setShowTableFilterMenu: Dispatch<SetStateAction<boolean>>;
  showExportMenu: boolean;
  setShowExportMenu: Dispatch<SetStateAction<boolean>>;
  tableSearch: string;
  setTableSearch: Dispatch<SetStateAction<string>>;
  columnsSearch: string;
  setColumnsSearch: Dispatch<SetStateAction<string>>;
  tableFilter: TableFilterState;
  setTableFilter: Dispatch<SetStateAction<TableFilterState>>;
  currentPage: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  rowsPerPage: number;
  setRowsPerPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  totalRecords: number;
  downloadCsv: () => void;
  showRowActionsFor: string | null;
  setShowRowActionsFor: Dispatch<SetStateAction<string | null>>;
}

export function LeadsDataTable({
  filteredRows,
  visibleColumns,
  setVisibleColumns,
  selectedRows,
  setSelectedRows,
  showColumnsMenu,
  setShowColumnsMenu,
  showTableFilterMenu,
  setShowTableFilterMenu,
  showExportMenu,
  setShowExportMenu,
  tableSearch,
  setTableSearch,
  columnsSearch,
  setColumnsSearch,
  tableFilter,
  setTableFilter,
  currentPage,
  setCurrentPage,
  rowsPerPage,
  setRowsPerPage,
  totalPages,
  totalRecords,
  downloadCsv,
  showRowActionsFor,
  setShowRowActionsFor,
}: LeadsDataTableProps) {
  return (
    <div className="rounded-xl border border-spy-border bg-spy-surface-primary">
      {/* ── Toolbar ── */}
      <div className="relative flex flex-wrap items-center justify-end gap-2 border-b border-spy-border p-3">
        <button
          onClick={() => setShowColumnsMenu((v) => !v)}
          className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-xs text-spy-text-primary"
        >
          Columns
        </button>
        <button
          onClick={() => setShowTableFilterMenu((v) => !v)}
          className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-xs text-spy-text-primary"
        >
          Filter
        </button>
        <button
          onClick={() => setShowExportMenu((v) => !v)}
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
                .filter((col) => col.label.toLowerCase().includes(columnsSearch.toLowerCase()))
                .map((col) => (
                  <label key={col.key} className="mb-1 flex cursor-pointer items-center gap-2 text-sm text-spy-text-primary">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(col.key)}
                      onChange={() =>
                        setVisibleColumns((cur) =>
                          cur.includes(col.key) ? cur.filter((k) => k !== col.key) : [...cur, col.key],
                        )
                      }
                    />
                    {col.label}
                  </label>
                ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-spy-border pt-2 text-xs">
              <button
                onClick={() => setVisibleColumns(tableColumns.map((c) => c.key))}
                className="text-spy-brand"
              >
                Show/Hide All
              </button>
              <button
                onClick={() => setVisibleColumns(tableColumns.map((c) => c.key))}
                className="text-spy-text-muted"
              >
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
                {tableFilterColumns.map((col) => (
                  <option key={col.key} value={col.key}>{col.label}</option>
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
            <button
              onClick={() => window.print()}
              className="block w-full px-3 py-2 text-left text-sm text-spy-text-primary hover:bg-spy-surface-primary"
            >
              Print
            </button>
            <button
              onClick={downloadCsv}
              className="block w-full px-3 py-2 text-left text-sm text-spy-text-primary hover:bg-spy-surface-primary"
            >
              Download as CSV
            </button>
          </div>
        )}
      </div>

      {/* ── Table ── */}
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
                        setSelectedRows((cur) =>
                          cur.includes(row._id) ? cur.filter((id) => id !== row._id) : [...cur, row._id],
                        )
                      }
                    />
                  </td>
                )}
                {visibleColumns.includes('sNo') && (
                  <td className="px-3 py-3">{(currentPage - 1) * rowsPerPage + index + 1}</td>
                )}
                {visibleColumns.includes('actions') && (
                  <td className="relative px-3 py-3">
                    <button
                      onClick={() => setShowRowActionsFor((cur) => (cur === row._id ? null : row._id))}
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
                {visibleColumns.includes('totalMTWeight') && (
                  <td className="px-3 py-3">{(row.gvwKgs ?? row.totalMTWeight).toFixed(0)}</td>
                )}
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
                {visibleColumns.includes('insuranceDueDate') && (
                  <td className="px-3 py-3">{safeDate(row.insuranceDueDate)?.toLocaleDateString('en-IN') || 'N/A'}</td>
                )}
                {visibleColumns.includes('leadSource') && <td className="px-3 py-3">{row.leadSource || 'N/A'}</td>}
                {visibleColumns.includes('permitValidUpto') && (
                  <td className="px-3 py-3">{safeDate(row.permitValidUpto)?.toLocaleDateString('en-IN') || 'N/A'}</td>
                )}
                {visibleColumns.includes('fitnessValidUpto') && (
                  <td className="px-3 py-3">{safeDate(row.fitnessValidUpto)?.toLocaleDateString('en-IN') || 'N/A'}</td>
                )}
                {visibleColumns.includes('pollutionValidUpto') && (
                  <td className="px-3 py-3">{safeDate(row.pollutionValidUpto)?.toLocaleDateString('en-IN') || 'N/A'}</td>
                )}
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
                <td
                  className="px-3 py-10 text-center text-sm text-spy-text-muted"
                  colSpan={Math.max(visibleColumns.length, 1)}
                >
                  No records match selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
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
          {totalRecords === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1}–
          {Math.min(currentPage * rowsPerPage, totalRecords)} of {totalRecords}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded border border-spy-border px-2 py-1 disabled:opacity-40"
          >
            {'<'}
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded border border-spy-border px-2 py-1 disabled:opacity-40"
          >
            {'>'}
          </button>
        </div>
      </div>
    </div>
  );
}
