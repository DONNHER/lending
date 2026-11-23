-- Shared SQLite and PostgreSQL table definitions. The migration selects PostgreSQL's 64-bit floating-point type.
-- 01. Identity & Access
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier', 'shareholder')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 02. Shareholder Membership & Fixed Share Capital
CREATE TABLE IF NOT EXISTS share_capital_settings (
  id TEXT PRIMARY KEY,
  required_initial_capital REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  effective_from TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shareholder_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_number TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  birth_date TEXT,
  contact_number TEXT,
  address TEXT,
  verification_status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (verification_status IN ('incomplete', 'pending_review', 'approved', 'rejected')),
  approved_at TEXT,
  approved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shareholder_documents (
  id TEXT PRIMARY KEY,
  shareholder_id TEXT NOT NULL REFERENCES shareholder_profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewer_id TEXT REFERENCES users(id),
  reviewer_remarks TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_capital_accounts (
  id TEXT PRIMARY KEY,
  shareholder_id TEXT UNIQUE NOT NULL REFERENCES shareholder_profiles(id) ON DELETE CASCADE,
  required_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid')),
  fully_paid_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_capital_payments (
  id TEXT PRIMARY KEY,
  capital_account_id TEXT NOT NULL REFERENCES share_capital_accounts(id) ON DELETE CASCADE,
  reference TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'gcash')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL
);

-- 03. Products & Inventory
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_details TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  base_unit TEXT NOT NULL DEFAULT 'kg',
  cost_price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  image_key TEXT NOT NULL DEFAULT 'fertilizer',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  conversion_factor REAL NOT NULL CHECK (conversion_factor > 0),
  selling_price REAL NOT NULL CHECK (selling_price >= 0),
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, unit_name)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  id TEXT PRIMARY KEY,
  product_id TEXT UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL DEFAULT 'Main Cooperative Warehouse',
  quantity_base REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL,
  quantity_base REAL NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_prod ON inventory_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS stock_receipts (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  received_by TEXT NOT NULL REFERENCES users(id),
  receipt_number TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL REFERENCES product_units(id),
  conversion_factor REAL NOT NULL
);

-- 04. POS & Online Shop Orders
CREATE TABLE IF NOT EXISTS pos_terminals (
  id TEXT PRIMARY KEY,
  terminal_code TEXT UNIQUE NOT NULL,
  location_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_sync_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  shareholder_id TEXT NOT NULL REFERENCES shareholder_profiles(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft', 'confirmed', 'fulfilled', 'cancelled')),
  total REAL NOT NULL,
  token_code TEXT UNIQUE NOT NULL,
  token_expires_at TEXT NOT NULL,
  token_used_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  conversion_factor REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  sale_number TEXT UNIQUE NOT NULL,
  cashier_id TEXT NOT NULL REFERENCES users(id),
  terminal_id TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  shareholder_id TEXT REFERENCES shareholder_profiles(id),
  total REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash', 'bank_transfer')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'partially_returned', 'returned')),
  source TEXT NOT NULL DEFAULT 'online_pos',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  conversion_factor REAL NOT NULL,
  quantity_base REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  processed_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  total REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  quantity REAL NOT NULL,
  refund_amount REAL NOT NULL
);

-- 05. Loan Management
CREATE TABLE IF NOT EXISTS loan_settings (
  id TEXT PRIMARY KEY,
  capital_multiplier REAL NOT NULL DEFAULT 6,
  interest_rate REAL NOT NULL DEFAULT 0.06,
  default_term_months INTEGER NOT NULL DEFAULT 6,
  waiting_period_days INTEGER NOT NULL DEFAULT 7
);

CREATE TABLE IF NOT EXISTS loan_applications (
  id TEXT PRIMARY KEY,
  shareholder_id TEXT NOT NULL REFERENCES shareholder_profiles(id),
  requested_amount REAL NOT NULL,
  term_months INTEGER NOT NULL DEFAULT 6,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected')),
  reviewer_id TEXT REFERENCES users(id),
  reviewer_remarks TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  loan_number TEXT UNIQUE NOT NULL,
  shareholder_id TEXT NOT NULL REFERENCES shareholder_profiles(id),
  application_id TEXT UNIQUE NOT NULL REFERENCES loan_applications(id),
  principal REAL NOT NULL,
  interest_rate REAL NOT NULL,
  interest_amount REAL NOT NULL,
  term_months INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'disbursed', 'active', 'overdue', 'fully_paid')),
  disbursed_at TEXT,
  disbursement_reference TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_installments (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  principal_due REAL NOT NULL,
  interest_due REAL NOT NULL,
  fees_due REAL NOT NULL DEFAULT 0,
  amount_due REAL NOT NULL,
  principal_paid REAL NOT NULL DEFAULT 0,
  interest_paid REAL NOT NULL DEFAULT 0,
  fees_paid REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS loan_payments (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  reference TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS loan_payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES loan_payments(id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL REFERENCES loan_installments(id),
  principal_paid REAL NOT NULL,
  interest_paid REAL NOT NULL,
  fees_paid REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_eligibility (
  shareholder_id TEXT PRIMARY KEY REFERENCES shareholder_profiles(id) ON DELETE CASCADE,
  withdrawal_blocked INTEGER NOT NULL DEFAULT 0,
  restriction_reason TEXT,
  next_eligible_at TEXT,
  updated_at TEXT NOT NULL
);

-- 06. Offline Synchronization
CREATE TABLE IF NOT EXISTS sync_batches (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  received_count INTEGER NOT NULL,
  processed_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  conflict_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  batch_id TEXT NOT NULL REFERENCES sync_batches(id),
  terminal_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processed', 'duplicate_ignored', 'conflict')),
  central_sale_id TEXT,
  conflict_reason TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  requested_base_qty REAL NOT NULL,
  available_base_qty REAL NOT NULL,
  reason TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open', 'accepted_negative_adjustment', 'voided')),
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

-- Additional PDF Tables: RBAC, Sessions, Reviews, Units, Locations, Adjustments, Devices, Carts, Order Tokens, Payments, Loan History & Sync Cursors
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  module TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_user (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permission_role (
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (permission_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_reviews (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES shareholder_documents(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  remarks TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  abbreviation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_locations (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  location_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  direction TEXT NOT NULL CHECK (direction IN ('increase', 'decrease')),
  quantity_base REAL NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pos_devices (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES pos_terminals(id) ON DELETE CASCADE,
  device_identifier TEXT UNIQUE NOT NULL,
  last_sync_at TEXT
);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  shareholder_id TEXT NOT NULL REFERENCES shareholder_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'abandoned')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL REFERENCES product_units(id)
);

CREATE TABLE IF NOT EXISTS order_tokens (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('pos_sale', 'order_fulfillment', 'offline_sync', 'loan_repayment', 'share_capital')),
  transaction_id TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash', 'bank_transfer')),
  reference TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_reviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
  manager_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  remarks TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_disbursements (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  reference TEXT UNIQUE NOT NULL,
  disbursed_by TEXT REFERENCES users(id),
  disbursed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_sync_states (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  device_identifier TEXT UNIQUE NOT NULL,
  last_cursor TEXT NOT NULL,
  last_sync_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 07. Data Import/Export, Backups, Scheduled Tasks & Rate Limit Telemetry
CREATE TABLE IF NOT EXISTS import_logs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  format TEXT NOT NULL,
  duplicate_mode TEXT NOT NULL CHECK (duplicate_mode IN ('skip', 'update')),
  total_rows INTEGER NOT NULL,
  processed_rows INTEGER NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failures_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_logs (
  id TEXT PRIMARY KEY,
  export_type TEXT NOT NULL,
  format TEXT NOT NULL,
  period TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_monitoring (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL,
  storage_location TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  retention_tier TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  task_name TEXT UNIQUE NOT NULL,
  frequency TEXT NOT NULL,
  description TEXT NOT NULL,
  last_run_at TEXT,
  next_run_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'healthy',
  last_duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  limit_per_min INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
