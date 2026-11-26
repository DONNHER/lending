import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditLog, Product } from '../types/domain';
import type { ProductImportRowError } from './productImport';
import type { ReportPeriod } from './reportPeriods';

export type ReportTabView = 'overview' | 'pos' | 'loans';

export interface CooperativeReportData {
  period: ReportPeriod;
  period_label: string;
  start_iso: string;
  end_iso: string;
  kpis: {
    total_revenue: number;
    sales_count: number;
    inventory_value: number;
    inventory_base_kg: number;
    verified_share_capital: number;
    loan_portfolio_principal: number;
    loan_count: number;
    pending_docs: number;
    pending_loan_apps: number;
    open_sync_conflicts: number;
  };
  sales_by_category: Array<{ category: string; revenue: number }>;
  stock_by_category: Array<{ category: string; quantity_base: number; cost_value: number }>;
  pos_report: {
    total_revenue: number;
    sales_count: number;
    average_ticket: number;
    preorder_fulfillments: number;
    by_payment_method: Array<{ payment_method: string; count: number; revenue: number }>;
    top_products: Array<{
      product_name: string;
      sku: string;
      quantity_base: number;
      revenue: number;
    }>;
    recent_sales: Array<{
      id: string;
      sale_number: string;
      cashier_name: string;
      terminal_id: string;
      payment_method: string;
      source: string;
      status: string;
      total: number;
      created_at: string;
    }>;
  };
  loans_report: {
    total_loans: number;
    active_loans: number;
    overdue_loans: number;
    fully_paid_loans: number;
    total_principal: number;
    total_interest: number;
    total_collected: number;
    total_outstanding: number;
    by_status: Array<{ status: string; count: number; principal: number }>;
    loans: Array<{
      id: string;
      loan_number: string;
      shareholder_name: string;
      membership_number: string;
      principal: number;
      interest_amount: number;
      term_months: number;
      status: string;
      total_paid: number;
      outstanding_balance: number;
      created_at: string;
    }>;
  };
}

function pdfCurrency(amount: number): string {
  return `PHP ${Number(amount || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const PDF_MARGIN = { top: 105, bottom: 52, left: 40, right: 40 };

function brandReportPages(doc: jsPDF, title: string, subtitle: string, generatedAt: Date) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const generated = generatedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFillColor(20, 83, 45);
    doc.roundedRect(40, 26, 31, 31, 6, 6, 'F');
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(1.3);
    doc.lines([[0, -8, 8, -9, 14, -10], [0, 7, -2, 13, -10, 14], [-3, 0, -4, -1, -4, -4]], 48, 46, [1, 1], 'S');
    doc.line(47, 49, 56, 42);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 83, 45);
    doc.text('Argivit Agricultural Supply Cooperative', 82, 40);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(title, 82, 55);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(subtitle, 40, 81);
    doc.setDrawColor(206, 222, 212);
    doc.setLineWidth(0.7);
    doc.line(40, 91, width - 40, 91);
    doc.line(40, height - 40, width - 40, height - 40);
    doc.text(`Generated ${generated}`, 40, height - 24);
    doc.text(`Page ${page} of ${pageCount}`, width - 40, height - 24, { align: 'right' });
  }
}

export function exportProductImportErrors(errors: ProductImportRowError[], sourceFile: string): string {
  const baseName = sourceFile.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'catalog';
  const filename = `${baseName}-import-errors.xlsx`;
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Row', 'SKU', 'Product name', 'Error'],
    ...errors.map(({ rowNumber, sku, name, reason }) => [rowNumber, sku, name, reason]),
  ]);
  worksheet['!cols'] = [{ wch: 8 }, { wch: 20 }, { wch: 28 }, { wch: 65 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, worksheet, 'Import errors');
  XLSX.writeFile(book, filename);
  return filename;
}

export function exportCooperativeReportExcel(
  data: CooperativeReportData,
  activeView: ReportTabView
): string {
  const wb = XLSX.utils.book_new();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `argivit-${activeView}-report-${data.period}-${stamp}.xlsx`;

  const summaryRows = [
    { Metric: 'Report Period', Value: data.period_label },
    { Metric: 'Date Range Start (UTC)', Value: data.start_iso },
    { Metric: 'Date Range End (UTC)', Value: data.end_iso },
    { Metric: 'Total POS & Pre-Order Revenue', Value: data.kpis.total_revenue },
    { Metric: 'Completed Sales Count', Value: data.kpis.sales_count },
    { Metric: 'Warehouse Cost Value', Value: data.kpis.inventory_value },
    { Metric: 'Warehouse Base Stock (kg)', Value: data.kpis.inventory_base_kg },
    { Metric: 'Verified Share Capital Pool', Value: data.kpis.verified_share_capital },
    { Metric: 'Loan Principal (Period)', Value: data.loans_report.total_principal },
    { Metric: 'Loan Interest (Period)', Value: data.loans_report.total_interest },
    { Metric: 'Loan Collected Repayments', Value: data.loans_report.total_collected },
    { Metric: 'Loan Outstanding Balance', Value: data.loans_report.total_outstanding },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Executive Summary');

  const posSalesSheetRows = data.pos_report.recent_sales.map((s) => ({
    SaleNumber: s.sale_number,
    Date: s.created_at,
    Cashier: s.cashier_name,
    Terminal: s.terminal_id,
    PaymentMethod: s.payment_method,
    Source: s.source,
    Status: s.status,
    TotalPHP: s.total,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      posSalesSheetRows.length > 0
        ? posSalesSheetRows
        : [{ Message: 'No POS sales recorded in this period.' }]
    ),
    'POS Sales'
  );

  const topProdRows = data.pos_report.top_products.map((p) => ({
    SKU: p.sku,
    Product: p.product_name,
    BaseSoldKg: p.quantity_base,
    RevenuePHP: p.revenue,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      topProdRows.length > 0 ? topProdRows : [{ Message: 'No product sales in this period.' }]
    ),
    'Top Products'
  );

  const loanRows = data.loans_report.loans.map((l) => ({
    LoanNumber: l.loan_number,
    Shareholder: l.shareholder_name,
    MembershipNo: l.membership_number,
    Status: l.status,
    PrincipalPHP: l.principal,
    InterestPHP: l.interest_amount,
    TermMonths: l.term_months,
    TotalPaidPHP: l.total_paid,
    OutstandingPHP: l.outstanding_balance,
    CreatedAt: l.created_at,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      loanRows.length > 0 ? loanRows : [{ Message: 'No loans recorded in this period.' }]
    ),
    'Loans Report'
  );

  const stockRows = data.stock_by_category.map((c) => ({
    Category: c.category,
    BaseStockKg: c.quantity_base,
    CostValuePHP: c.cost_value,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockRows), 'Inventory Stock');

  XLSX.writeFile(wb, filename);
  return filename;
}

export function exportCooperativeReportPdf(
  data: CooperativeReportData,
  activeView: ReportTabView
): string {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const generated = new Date();
  const stamp = generated.toISOString().slice(0, 10);
  const filename = `argivit-${activeView}-report-${data.period}-${stamp}.pdf`;

  const titleByView: Record<ReportTabView, string> = {
    overview: 'Cooperative Financial & Inventory Report',
    pos: 'POS & Pre-Order Sales Report',
    loans: 'Cooperative Loan Portfolio Report',
  };

  let nextY = PDF_MARGIN.top;

  if (activeView === 'overview' || activeView === 'pos') {
    autoTable(doc, {
      margin: PDF_MARGIN,
      startY: nextY,
      head: [['Financial & POS Metric', 'Value']],
      body: [
        ['POS & Pre-Order Revenue (Period)', pdfCurrency(data.pos_report.total_revenue)],
        ['Completed Sales Count (Period)', String(data.pos_report.sales_count)],
        ['Average Ticket Size', pdfCurrency(data.pos_report.average_ticket)],
        ['Pre-Order Fulfillments', String(data.pos_report.preorder_fulfillments)],
        ['Warehouse Cost Value', pdfCurrency(data.kpis.inventory_value)],
        ['Verified Share Capital Pool', pdfCurrency(data.kpis.verified_share_capital)],
      ],
      headStyles: { fillColor: [21, 128, 61] },
      styles: { fontSize: 9 },
    });
    nextY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;

    if (data.pos_report.recent_sales.length > 0) {
      autoTable(doc, {
        margin: PDF_MARGIN,
        startY: nextY,
        head: [['Sale #', 'Cashier', 'Method', 'Source', 'Total']],
        body: data.pos_report.recent_sales.map((s) => [
          s.sale_number,
          s.cashier_name,
          s.payment_method.toUpperCase(),
          s.source.replace('_', ' '),
          pdfCurrency(s.total),
        ]),
        headStyles: { fillColor: [22, 101, 52] },
        styles: { fontSize: 8 },
      });
      nextY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
    }
  }

  if (activeView === 'overview' || activeView === 'loans') {
    autoTable(doc, {
      margin: PDF_MARGIN,
      startY: nextY,
      head: [['Loan Portfolio Metric', 'Value']],
      body: [
        ['Loan Accounts (Period)', String(data.loans_report.total_loans)],
        ['Active / Overdue Accounts', `${data.loans_report.active_loans} active / ${data.loans_report.overdue_loans} overdue`],
        ['Principal Disbursed / Approved', pdfCurrency(data.loans_report.total_principal)],
        ['Total Flat Interest', pdfCurrency(data.loans_report.total_interest)],
        ['Total Repayments Collected', pdfCurrency(data.loans_report.total_collected)],
        ['Outstanding Loan Balance', pdfCurrency(data.loans_report.total_outstanding)],
      ],
      headStyles: { fillColor: [21, 128, 61] },
      styles: { fontSize: 9 },
    });
    nextY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;

    if (data.loans_report.loans.length > 0) {
      autoTable(doc, {
        margin: PDF_MARGIN,
        startY: nextY,
        head: [['Loan #', 'Member', 'Status', 'Principal', 'Paid', 'Balance']],
        body: data.loans_report.loans.map((l) => [
          l.loan_number,
          l.shareholder_name,
          l.status.replace('_', ' '),
          pdfCurrency(l.principal),
          pdfCurrency(l.total_paid),
          pdfCurrency(l.outstanding_balance),
        ]),
        headStyles: { fillColor: [22, 101, 52] },
        styles: { fontSize: 8 },
      });
    }
  }

  brandReportPages(doc, titleByView[activeView], `Period: ${data.period_label}`, generated);
  doc.save(filename);
  return filename;
}

export function downloadProductImportTemplate(
  format: 'xlsx' | 'csv',
  sampleCategories: Array<{ name: string }>
): string {
  const cat1 = sampleCategories[0]?.name || 'Fertilizers & Soil';
  const cat2 = sampleCategories[1]?.name || 'Seeds & Planting';

  const sampleRows = [
    {
      SKU: 'AGR-FERT-801',
      Name: 'Urea Prilled 46-0-0 Cooperative Blend',
      Category: cat1,
      CostPrice: 24.5,
      Stock: 500,
      Description: 'High-nitrogen granular urea fertilizer for topdressing rice and corn.',
      Barcode: '480001008001',
      SackWeightKg: 50,
      SackPrice: 1450,
      KgPrice: 31,
    },
    {
      SKU: 'AGR-SEED-802',
      Name: 'NSIC Rc222 Certified Palay Seeds',
      Category: cat2,
      CostPrice: 165,
      Stock: 200,
      Description: 'High-yielding certified inbred rice seeds packed in 20 kg sacks.',
      Barcode: '480001008002',
      SackWeightKg: 20,
      SackPrice: 3800,
      KgPrice: 205,
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ProductsTemplate');

  const filename = `argivit-products-import-template.${format}`;
  if (format === 'csv') {
    XLSX.writeFile(wb, filename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(wb, filename);
  }
  return filename;
}

export type ProductExportColumn =
  | 'SKU'
  | 'Barcode'
  | 'Name'
  | 'Category'
  | 'CostPrice'
  | 'StockKg'
  | 'Units'
  | 'Status';

export function exportProductsDataset(
  products: Product[],
  columns: ProductExportColumn[],
  format: 'xlsx' | 'csv' | 'pdf'
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `argivit-inventory-export-${stamp}.${format}`;
  const selectedCols: ProductExportColumn[] =
    columns.length > 0 ? columns : ['SKU', 'Name', 'Category', 'CostPrice', 'StockKg'];

  const rows = products.map((p) => {
    const out: Record<string, string | number> = {};
    for (const col of selectedCols) {
      switch (col) {
        case 'SKU':
          out.SKU = p.sku;
          break;
        case 'Barcode':
          out.Barcode = p.barcode || '';
          break;
        case 'Name':
          out.Name = p.name;
          break;
        case 'Category':
          out.Category = p.category_name || p.category_id;
          break;
        case 'CostPrice':
          out.CostPrice = p.cost_price;
          break;
        case 'StockKg':
          out.StockKg = p.stock_base;
          break;
        case 'Units':
          out.Units = p.units.map((u) => `${u.unit_name}: ${u.selling_price}`).join(' | ');
          break;
        case 'Status':
          out.Status = p.status;
          break;
      }
    }
    return out;
  });

  if (format === 'pdf') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    autoTable(doc, {
      margin: PDF_MARGIN,
      head: [selectedCols],
      body: rows.map((r) => selectedCols.map((c) => String(r[c] ?? ''))),
      headStyles: { fillColor: [21, 128, 61] },
      styles: { fontSize: 8 },
    });
    brandReportPages(doc, 'Filtered Warehouse Inventory', `Products: ${rows.length}`, new Date());
    doc.save(filename);
    return filename;
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  if (format === 'csv') {
    XLSX.writeFile(wb, filename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(wb, filename);
  }
  return filename;
}

export function exportAuditLogsDataset(logs: AuditLog[], format: 'csv' | 'pdf' | 'xlsx'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `argivit-audit-trail-${stamp}.${format}`;

  if (format === 'pdf') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    autoTable(doc, {
      margin: PDF_MARGIN,
      head: [['Action', 'Actor', 'Entity', 'Metadata', 'Timestamp']],
      body: logs.map((l) => [
        l.action,
        l.actor_name,
        `${l.entity_type} · ${l.entity_id}`,
        JSON.stringify(l.metadata || {}).slice(0, 90),
        l.created_at,
      ]),
      headStyles: { fillColor: [21, 128, 61] },
      styles: { fontSize: 8 },
    });
    brandReportPages(doc, 'Compliance Audit Trail', `Records: ${logs.length}`, new Date());
    doc.save(filename);
    return filename;
  }

  const rows = logs.map((l) => ({
    ID: l.id,
    Action: l.action,
    ActorID: l.actor_id,
    ActorName: l.actor_name,
    EntityType: l.entity_type,
    EntityID: l.entity_id,
    Metadata: JSON.stringify(l.metadata || {}),
    Timestamp: l.created_at,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'AuditLogs');
  XLSX.writeFile(wb, filename, { bookType: format });
  return filename;
}
