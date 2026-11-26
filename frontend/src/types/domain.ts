export type UserRole = 'admin' | 'manager' | 'cashier' | 'shareholder';
export type AccountStatus = 'active' | 'disabled';
export type VerificationStatus = 'incomplete' | 'pending_review' | 'approved' | 'rejected';
export type CapitalStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentRecordStatus = 'pending' | 'verified' | 'rejected';

export interface User {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: UserRole;
  account_status: AccountStatus;
  created_at: string;
}

export interface SessionStatus {
  id: string;
  expires_at: string;
  remembered: boolean;
  idle_timeout: boolean;
}

export interface AccountDevice extends SessionStatus {
  device: string | null;
  created_at: string;
  last_active_at: string | null;
  active: boolean;
  current: boolean;
}

export interface AuthSession {
  session?: SessionStatus | null;
  token: string;
  user: User;
  impersonated_by?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ShareholderProfile {
  id: string;
  user_id: string;
  membership_number: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  birth_date?: string | null;
  contact_number?: string | null;
  address?: string | null;
  verification_status: VerificationStatus;
  approved_at?: string | null;
  approved_by?: string | null;
  created_at: string;
}

export type LandPaperType = 'original_land_paper' | 'notarized_land_paper';

export interface ShareholderDocument {
  id: string;
  shareholder_id: string;
  document_type: LandPaperType | 'government_id' | 'proof_of_residency' | 'farm_registration' | 'membership_form';
  file_name: string;
  file_path: string;
  has_file?: boolean;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_remarks?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface ShareCapitalAccount {
  id: string;
  shareholder_id: string;
  required_amount: number;
  paid_amount: number;
  status: CapitalStatus;
  fully_paid_at?: string | null;
  created_at: string;
}

export interface ShareCapitalPayment {
  id: string;
  capital_account_id: string;
  reference: string;
  amount: number;
  payment_method: 'cash' | 'bank_transfer' | 'gcash';
  status: PaymentRecordStatus;
  verified_by?: string | null;
  verified_at?: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  unit_name: string;
  conversion_factor: number;
  selling_price: number;
  is_default: boolean;
}

export interface Product {
  id: string;
  category_id: string;
  category_name?: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string;
  base_unit: string;
  cost_price: number;
  status: 'active' | 'inactive';
  image_url: string;
  stock_base: number;
  units: ProductUnit[];
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  base_unit?: string;
  movement_type: 'receipt' | 'sale' | 'return' | 'adjustment_in' | 'adjustment_out' | 'sync_sale';
  quantity_base: number;
  reference_type: string;
  reference_id: string;
  created_by: string;
  created_by_name?: string;
  notes?: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_details: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_id: string;
  unit_name: string;
  conversion_factor: number;
  unit_price: number;
  line_total: number;
}

export interface Order {
  id: string;
  order_number: string;
  shareholder_id: string;
  shareholder_name?: string;
  membership_number?: string;
  status: 'draft' | 'confirmed' | 'fulfilled' | 'cancelled';
  total: number;
  token_code: string;
  token_expires_at: string;
  token_used_at?: string | null;
  notes?: string | null;
  created_at: string;
  items: OrderItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_id: string;
  unit_name: string;
  conversion_factor: number;
  quantity_base: number;
  unit_price: number;
  line_total: number;
}

export interface Sale {
  id: string;
  sale_number: string;
  cashier_id: string;
  cashier_name?: string;
  terminal_id: string;
  order_id?: string | null;
  shareholder_id?: string | null;
  total: number;
  payment_method: 'cash' | 'gcash' | 'bank_transfer';
  status: 'completed' | 'partially_returned' | 'returned';
  source: 'online_pos' | 'offline_sync' | 'preorder_fulfillment';
  created_at: string;
  items: SaleItem[];
}

export type LoanApplicationStatus = 'submitted' | 'under_review' | 'approved' | 'rejected';
export type LoanStatus = 'approved' | 'disbursed' | 'active' | 'overdue' | 'fully_paid';
export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface LoanSettings {
  capital_multiplier: number;
  interest_rate: number; // e.g., 0.06 = 6% flat or per term
  default_term_months: number;
  waiting_period_days: number;
  required_initial_capital: number;
  currency: string;
}

export interface LoanApplication {
  id: string;
  shareholder_id: string;
  shareholder_name?: string;
  membership_number?: string;
  requested_amount: number;
  term_months: number;
  purpose: string;
  status: LoanApplicationStatus;
  reviewer_id?: string | null;
  reviewer_remarks?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface LoanInstallment {
  id: string;
  loan_id: string;
  installment_number: number;
  due_date: string;
  principal_due: number;
  interest_due: number;
  fees_due: number;
  amount_due: number;
  principal_paid: number;
  interest_paid: number;
  fees_paid: number;
  amount_paid: number;
  status: InstallmentStatus;
  paid_at?: string | null;
}

export interface LoanPayment {
  id: string;
  loan_id: string;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'gcash' | 'bank_transfer';
  reference: string;
  recorded_by: string;
}

export interface Loan {
  id: string;
  loan_number: string;
  shareholder_id: string;
  shareholder_name?: string;
  membership_number?: string;
  application_id: string;
  principal: number;
  interest_rate: number;
  interest_amount: number;
  term_months: number;
  status: LoanStatus;
  disbursed_at?: string | null;
  disbursement_reference?: string | null;
  completed_at?: string | null;
  created_at: string;
  installments: LoanInstallment[];
  payments: LoanPayment[];
  computed_total_payable: number;
  computed_total_paid: number;
  computed_balance: number;
}

export type LoanStateStage =
  | 'MEMBERSHIP'
  | 'ELIGIBLE'
  | 'APPLICATION_SUBMITTED'
  | 'MANAGER_REVIEW'
  | 'APPROVED'
  | 'DISBURSED'
  | 'ACTIVE_LOAN'
  | 'REAPPLICATION_ALLOWED'
  | 'WITHDRAWAL_SUSPENDED'
  | 'WAITING_PERIOD'
  | 'HIGHER_LOAN_PRIVILEGE';

export interface LoanEligibilityEvaluation {
  eligible: boolean;
  reason?: string;
  available_at?: string | null;
  maximum_loan: number;
  available_credit: number;
  verified_capital: number;
  capital_multiplier: number;
  currency: string;
  stage: LoanStateStage;
  reapplication_allowed: boolean;
  higher_loan_privilege: boolean;
  withdrawal_blocked: boolean;
  has_active_loan: boolean;
  has_overdue_installment: boolean;
}

export interface OfflineSyncEventPayload {
  event_id: string;
  event_type: 'pos.sale.completed';
  terminal_id: string;
  cashier_id?: string;
  occurred_at: string;
  payload: {
    sale_id: string;
    payment_method: 'cash' | 'gcash' | 'bank_transfer';
    items: Array<{
      product_id: string;
      product_name: string;
      sku: string;
      unit_id: string;
      unit_name: string;
      quantity: number;
      conversion_factor: number;
      quantity_base: number;
      unit_price: number;
      line_total: number;
    }>;
    total: number;
  };
}

export interface SyncEventRecord {
  id: string;
  event_id: string;
  batch_id: string;
  terminal_id: string;
  event_type: string;
  status: 'processed' | 'duplicate_ignored' | 'conflict';
  central_sale_id?: string | null;
  conflict_reason?: string | null;
  payload_json: string;
  created_at: string;
}

export interface SyncConflictRecord {
  id: string;
  event_id: string;
  terminal_id: string;
  product_id: string;
  product_name: string;
  requested_base_qty: number;
  available_base_qty: number;
  reason: string;
  resolution_status: 'open' | 'accepted_negative_adjustment' | 'voided';
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta: Record<string, unknown> | null;
  errors?: Record<string, string[]>;
}

export interface ImportLogRecord {
  id: string;
  filename: string;
  format: string;
  duplicate_mode: 'skip' | 'update';
  total_rows: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  failures: Array<{ rowNumber: number; sku: string; name: string; reason: string }>;
  status: string;
  user_id: string;
  user_name: string;
  created_at: string;
}

export interface ExportLogRecord {
  id: string;
  export_type: string;
  format: string;
  period: string;
  row_count: number;
  status: string;
  user_id: string;
  user_name: string;
  created_at: string;
}

export interface BackupMonitoringRecord {
  id: string;
  backup_type: string;
  storage_location: string;
  size_bytes: number;
  status: string;
  retention_tier: string;
  triggered_by: string;
  notes?: string | null;
  created_at: string;
}

export interface ScheduledTaskRecord {
  id: string;
  task_name: string;
  frequency: string;
  description: string;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string;
  last_duration_ms: number;
}

