import { useState, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Upload,
} from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/productAssets';
import {
  chunkArray,
  PRODUCT_IMPORT_CHUNK_SIZE,
  REQUIRED_PRODUCT_IMPORT_HEADERS,
  validateAndNormalizeImportRow,
  validateImportHeaders,
  type NormalizedProductImportRow,
  type ProductImportRowError,
  type RawProductImportRow,
} from '../../lib/productImport';
import {
  downloadProductImportTemplate,
  exportProductsDataset,
  type ProductExportColumn,
} from '../../lib/reportExport';
import type { Category, ImportLogRecord, Product } from '../../types/domain';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState, StatusLabel } from '../ui/StateViews';

const EXPORT_COLUMNS: Array<{ id: ProductExportColumn; label: string }> = [
  { id: 'SKU', label: 'SKU' },
  { id: 'Barcode', label: 'Barcode' },
  { id: 'Name', label: 'Product Name' },
  { id: 'Category', label: 'Category' },
  { id: 'CostPrice', label: 'Cost / kg' },
  { id: 'StockKg', label: 'Stock (kg)' },
  { id: 'Units', label: 'Selling Units' },
  { id: 'Status', label: 'Status' },
];

export function ProductImportExportPanel({
  categories,
  allProducts,
  onFeedback,
}: {
  categories: Category[];
  allProducts: Product[];
  onFeedback: (msg: { tone: 'green' | 'red'; text: string }) => void;
}) {
  const queryClient = useQueryClient();

  const [selectedFile, setSelectedFile] = useState<{ name: string; format: string } | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [validRows, setValidRows] = useState<NormalizedProductImportRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<ProductImportRowError[]>([]);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastResult, setLastResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    failures: ProductImportRowError[];
  } | null>(null);

  // Filtered Export State
  const [exportCategory, setExportCategory] = useState<string>('all');
  const [exportStockFilter, setExportStockFilter] = useState<'all' | 'low' | 'in_stock'>('all');
  const [exportColumns, setExportColumns] = useState<ProductExportColumn[]>([
    'SKU',
    'Barcode',
    'Name',
    'Category',
    'CostPrice',
    'StockKg',
    'Units',
  ]);

  const importLogsQuery = useQuery({
    queryKey: ['product-import-logs'],
    queryFn: async () => (await apiRequest<ImportLogRecord[]>('/products/import-logs')).data,
  });

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setHeaderError(null);
    setValidRows([]);
    setValidationErrors([]);
    setLastResult(null);

    const ext = file.name.split('.').pop()?.toLowerCase() || 'xlsx';
    setSelectedFile({ name: file.name, format: ext });

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        setHeaderError('The uploaded workbook contains no sheets.');
        return;
      }

      const sheet = wb.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
      const rawHeaders = (matrix[0] || []).map((h) => String(h || '').trim()).filter(Boolean);

      const headerCheck = validateImportHeaders(rawHeaders);
      if (!headerCheck.valid) {
        setHeaderError(
          `Missing required column headers: ${headerCheck.missing.join(', ')}. Required headers: ${REQUIRED_PRODUCT_IMPORT_HEADERS.join(', ')}.`
        );
        return;
      }

      const rawRecords = XLSX.utils.sheet_to_json<RawProductImportRow>(sheet, { defval: '' });
      const nextValid: NormalizedProductImportRow[] = [];
      const nextErrors: ProductImportRowError[] = [];

      rawRecords.forEach((rawRow, index) => {
        const res = validateAndNormalizeImportRow(rawRow, index + 2, categories);
        if (res.ok) {
          nextValid.push(res.row);
        } else {
          nextErrors.push(res.error);
        }
      });

      setValidRows(nextValid);
      setValidationErrors(nextErrors);
    } catch {
      setHeaderError('Unable to parse file. Please upload a valid .xlsx, .xls, or .csv file.');
    }
  }

  async function handleCommitImport() {
    if (!selectedFile || validRows.length === 0) return;

    setConfirmImportOpen(false);
    setImporting(true);
    const chunks = chunkArray(validRows, PRODUCT_IMPORT_CHUNK_SIZE);
    setChunkProgress({ current: 0, total: chunks.length });

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalFailed = validationErrors.length;
    const allFailures: ProductImportRowError[] = [...validationErrors];

    try {
      for (let i = 0; i < chunks.length; i++) {
        setChunkProgress({ current: i + 1, total: chunks.length });
        const res = await apiRequest<{
          created_count: number;
          updated_count: number;
          skipped_count: number;
          failed_count: number;
          failures: ProductImportRowError[];
        }>('/products/import', {
          method: 'POST',
          body: JSON.stringify({
            filename: selectedFile.name,
            format: selectedFile.format,
            duplicate_mode: duplicateMode,
            chunk_index: i,
            total_chunks: chunks.length,
            rows: chunks[i],
          }),
        });

        totalCreated += res.data.created_count;
        totalUpdated += res.data.updated_count;
        totalSkipped += res.data.skipped_count;
        totalFailed += res.data.failed_count;
        if (Array.isArray(res.data.failures)) {
          allFailures.push(...res.data.failures);
        }
      }

      setLastResult({
        created: totalCreated,
        updated: totalUpdated,
        skipped: totalSkipped,
        failed: totalFailed,
        failures: allFailures,
      });

      onFeedback({
        tone: 'green',
        text: `Excel import completed: ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} skipped${totalFailed > 0 ? `, ${totalFailed} failed` : ''}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory-balances'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-all-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      queryClient.invalidateQueries({ queryKey: ['shop-products'] });
      queryClient.invalidateQueries({ queryKey: ['product-import-logs'] });
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
    } catch (err) {
      onFeedback({
        tone: 'red',
        text: err instanceof ApiError ? err.message : 'Bulk product import failed.',
      });
    } finally {
      setImporting(false);
      setChunkProgress(null);
    }
  }

  function toggleColumn(col: ProductExportColumn) {
    setExportColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  }

  const filteredExportProducts = allProducts.filter((p) => {
    if (exportCategory !== 'all' && p.category_id !== exportCategory) return false;
    if (exportStockFilter === 'low' && p.stock_base >= 200) return false;
    if (exportStockFilter === 'in_stock' && p.stock_base < 200) return false;
    return true;
  });

  async function handleFilteredExport(format: 'xlsx' | 'csv' | 'pdf') {
    const filename = exportProductsDataset(filteredExportProducts, exportColumns, format);
    onFeedback({
      tone: 'green',
      text: `Exported ${filteredExportProducts.length} product(s) to ${filename}.`,
    });
    try {
      await apiRequest('/reports/export-logs', {
        method: 'POST',
        body: JSON.stringify({
          export_type: 'inventory_products',
          format,
          period: 'custom_filter',
          row_count: filteredExportProducts.length,
          filters: { category: exportCategory, stock_status: exportStockFilter },
        }),
      });
    } catch {
      // Export file already downloaded
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* EXCEL / CSV BULK IMPORT CARD */}
        <section className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-[#0F172A]">
                Bulk Product Import (Excel / CSV)
              </h2>
              <p className="text-xs text-[#64748B]">
                Upload .xlsx or .csv sheets with chunked validation (1,000 rows/batch) and duplicate protection
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => downloadProductImportTemplate('xlsx', categories)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>.xlsx Template</span>
              </button>
              <button
                type="button"
                onClick={() => downloadProductImportTemplate('csv', categories)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>.csv Template</span>
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-[#F7F9F8] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label
                htmlFor="excel-import-file"
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#15803D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534]"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Select Excel / CSV File</span>
              </label>
              <input
                id="excel-import-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="sr-only"
              />

              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="dup-mode" className="font-medium text-[#334155]">
                  Duplicates:
                </label>
                <select
                  id="dup-mode"
                  value={duplicateMode}
                  onChange={(e) => setDuplicateMode(e.target.value as 'skip' | 'update')}
                  className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A]"
                >
                  <option value="skip">Skip existing SKUs</option>
                  <option value="update">Update existing SKUs</option>
                </select>
              </div>
            </div>

            <div className="text-[11px] text-[#64748B]">
              Required headers:{' '}
              <span className="font-mono text-[#334155]">
                {REQUIRED_PRODUCT_IMPORT_HEADERS.join(', ')}
              </span>{' '}
              · Optional: <span className="font-mono">Barcode, SackWeightKg, SackPrice, KgPrice</span>
            </div>

            {selectedFile ? (
              <div className="text-xs font-medium text-[#0F172A]">
                Loaded file: <span className="font-mono">{selectedFile.name}</span>
              </div>
            ) : null}
          </div>

          {headerError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-[#991B1B]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{headerError}</span>
            </div>
          ) : null}

          {selectedFile && !headerError ? (
            <div className="space-y-3 rounded-lg border border-[#E2E8E4] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-[#15803D]">
                    Valid rows: {validRows.length}
                  </span>
                  <span className="font-semibold text-[#B45309]">
                    Validation errors: {validationErrors.length}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={validRows.length === 0 || importing}
                  onClick={() => setConfirmImportOpen(true)}
                  className="rounded-lg bg-[#15803D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534] disabled:opacity-40"
                >
                  {importing
                    ? `Processing Chunk ${chunkProgress?.current ?? 1}/${chunkProgress?.total ?? 1}...`
                    : `Import ${validRows.length} Valid Product(s)`}
                </button>
              </div>

              {chunkProgress ? (
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF3F0]">
                  <div
                    className="h-full bg-[#15803D] transition-all"
                    style={{
                      width: `${Math.round((chunkProgress.current / chunkProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              ) : null}

              {validationErrors.length > 0 ? (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-[#92400E]">
                  <div className="mb-1.5 font-semibold">
                    Skip-on-failure validation report ({validationErrors.length}):
                  </div>
                  <ul className="space-y-1">
                    {validationErrors.slice(0, 20).map((err, idx) => (
                      <li key={`${err.rowNumber}-${idx}`} className="font-mono text-[11px]">
                        Row {err.rowNumber} ({err.sku}): {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {lastResult ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-[#14532D]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">
                  Import summary: {lastResult.created} created · {lastResult.updated} updated ·{' '}
                  {lastResult.skipped} skipped · {lastResult.failed} failed
                </div>
                {lastResult.failures.length > 0 ? (
                  <div className="mt-1 text-[11px] text-[#92400E]">
                    First error: Row {lastResult.failures[0].rowNumber} — {lastResult.failures[0].reason}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {/* FILTERED WAREHOUSE EXPORT CARD */}
        <section className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A]">
              Filtered Catalog & Inventory Export
            </h2>
            <p className="text-xs text-[#64748B]">
              Filter by category or stock threshold, pick custom columns, and export as XLSX, CSV, or PDF
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="exp-cat" className="block text-xs font-medium text-[#334155]">
                Category Filter
              </label>
              <select
                id="exp-cat"
                value={exportCategory}
                onChange={(e) => setExportCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="exp-stock" className="block text-xs font-medium text-[#334155]">
                Stock Status Filter
              </label>
              <select
                id="exp-stock"
                value={exportStockFilter}
                onChange={(e) =>
                  setExportStockFilter(e.target.value as 'all' | 'low' | 'in_stock')
                }
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs"
              >
                <option value="all">All Stock Levels</option>
                <option value="low">Low Stock (&lt; 200 kg)</option>
                <option value="in_stock">In Stock (&ge; 200 kg)</option>
              </select>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-[#334155]">Custom Export Columns</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {EXPORT_COLUMNS.map((col) => (
                <label
                  key={col.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#E2E8E4] px-2.5 py-1.5 text-xs text-[#334155] hover:bg-[#F7F9F8]"
                >
                  <input
                    type="checkbox"
                    checked={exportColumns.includes(col.id)}
                    onChange={() => toggleColumn(col.id)}
                    className="accent-[#15803D]"
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8E4] pt-4">
            <span className="font-mono text-xs text-[#64748B] tabular-nums">
              Matching products: {filteredExportProducts.length}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={filteredExportProducts.length === 0 || exportColumns.length === 0}
                onClick={() => handleFilteredExport('xlsx')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#15803D] disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#15803D]" />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                disabled={filteredExportProducts.length === 0 || exportColumns.length === 0}
                onClick={() => handleFilteredExport('csv')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#15803D] disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5 text-[#15803D]" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                disabled={filteredExportProducts.length === 0 || exportColumns.length === 0}
                onClick={() => handleFilteredExport('pdf')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#166534] disabled:opacity-40"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Export PDF</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* IMPORT LOGS HISTORY TABLE */}
      <section className="overflow-hidden rounded-xl border border-[#E2E8E4] bg-white">
        <div className="border-b border-[#E2E8E4] px-5 py-4">
          <h3 className="font-display text-base font-semibold text-[#0F172A]">
            Product Import Logs
          </h3>
          <p className="text-xs text-[#64748B]">
            Audit history of Excel & CSV catalog uploads, duplicate mode, and skip-on-failure results
          </p>
        </div>

        {(importLogsQuery.data || []).length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No Excel imports recorded yet"
              description="Uploaded .xlsx or .csv product batches will appear here with row counts and error summaries."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E2E8E4] bg-[#F7F9F8] text-[#475569]">
                <tr>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Created / Updated</th>
                  <th className="px-4 py-3 text-right">Skipped / Failed</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Uploaded By</th>
                  <th className="px-4 py-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E4]">
                {(importLogsQuery.data || []).map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 font-mono font-medium text-[#0F172A]">
                      {log.filename}
                    </td>
                    <td className="px-4 py-3 capitalize text-[#475569]">{log.duplicate_mode}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[#15803D]">
                      +{log.created_count} / ~{log.updated_count}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[#64748B]">
                      {log.skipped_count} / {log.failed_count}
                    </td>
                    <td className="px-4 py-3">
                      <StatusLabel
                        tone={
                          log.status === 'completed'
                            ? 'green'
                            : log.status === 'completed_with_errors'
                            ? 'amber'
                            : 'red'
                        }
                        label={log.status.replace(/_/g, ' ')}
                      />
                    </td>
                    <td className="px-4 py-3 text-[#334155]">{log.user_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-[#64748B] tabular-nums">
                      {formatDateTime(log.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmImportOpen}
        title="Confirm Bulk Product Import"
        description="Process this validated Excel/CSV product sheet into the cooperative warehouse catalog."
        details={[
          { label: 'File', value: selectedFile?.name || '—' },
          { label: 'Valid Rows', value: `${validRows.length} product(s)` },
          { label: 'Validation Errors Skipped', value: `${validationErrors.length} row(s)` },
          {
            label: 'Duplicate Handling',
            value: duplicateMode === 'update' ? 'Update existing SKUs' : 'Skip duplicate SKUs',
          },
        ]}
        confirmLabel="Confirm & Import Products"
        tone="green"
        isPending={importing}
        onConfirm={handleCommitImport}
        onCancel={() => setConfirmImportOpen(false)}
      />
    </div>
  );
}
