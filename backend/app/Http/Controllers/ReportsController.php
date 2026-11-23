<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Sql;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

final class ReportsController
{
    public function overview(Request $request): JsonResponse
    {
        $period = $request->query('period');
        if (!in_array($period, ['daily', 'weekly', 'monthly', 'annually'], true)) {
            $period = 'monthly';
        }
        [$start, $end, $label] = $this->range($period);
        $dates = [$start, $end];
        $saleDateRange = Sql::dateRange('s.created_at');
        $sales = $this->sales($dates);
        $loans = $this->loans($dates);
        $inventory = Sql::one(<<<'SQL'
            SELECT COALESCE(SUM(ib.quantity_base * p.cost_price), 0) AS total_cost_value,
                   COALESCE(SUM(ib.quantity_base), 0) AS total_base_units
            FROM inventory_balances ib JOIN products p ON p.id = ib.product_id
            SQL);
        $verifiedCapital = Sql::one("SELECT COALESCE(SUM(amount), 0) AS total FROM share_capital_payments WHERE status = 'verified'")['total'];

        return Api::ok('Reports overview generated.', [
            'period' => $period,
            'period_label' => $label,
            'start_iso' => $start,
            'end_iso' => $end,
            'kpis' => [
                'total_revenue' => $sales['total_revenue'],
                'sales_count' => $sales['sales_count'],
                'inventory_value' => round((float) $inventory['total_cost_value'], 2),
                'inventory_base_kg' => round((float) $inventory['total_base_units'], 4),
                'verified_share_capital' => round((float) $verifiedCapital, 2),
                'loan_portfolio_principal' => $loans['total_principal'],
                'loan_count' => $loans['total_loans'],
                'pending_docs' => (int) Sql::one("SELECT COUNT(*) AS count FROM shareholder_documents WHERE review_status = 'pending'")['count'],
                'pending_loan_apps' => (int) Sql::one("SELECT COUNT(*) AS count FROM loan_applications WHERE status IN ('submitted', 'under_review')")['count'],
                'open_sync_conflicts' => (int) Sql::one("SELECT COUNT(*) AS count FROM sync_conflicts WHERE resolution_status = 'open'")['count'],
            ],
            'sales_by_category' => Sql::all(<<<SQL
                SELECT c.name AS category, CAST(ROUND(CAST(COALESCE(SUM(si.line_total), 0) AS NUMERIC), 2) AS DOUBLE PRECISION) AS revenue
                FROM sale_items si JOIN sales s ON s.id = si.sale_id
                JOIN products p ON p.id = si.product_id JOIN categories c ON c.id = p.category_id
                WHERE s.status <> 'returned' AND {$saleDateRange}
                GROUP BY c.name ORDER BY revenue DESC
                SQL, $dates),
            'stock_by_category' => Sql::all(<<<'SQL'
                SELECT c.name AS category, COALESCE(SUM(ib.quantity_base), 0) AS quantity_base,
                       COALESCE(SUM(ib.quantity_base * p.cost_price), 0) AS cost_value
                FROM products p JOIN categories c ON c.id = p.category_id
                LEFT JOIN inventory_balances ib ON ib.product_id = p.id
                GROUP BY c.id
                SQL),
            'pos_report' => $sales,
            'loans_report' => $loans,
        ]);
    }

    public function exportLogs(): JsonResponse
    {
        return Api::ok('Export logs retrieved.', Sql::all('SELECT * FROM export_logs ORDER BY created_at DESC LIMIT 30'));
    }

    public function logExport(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'export_type' => ['required', 'string'],
            'format' => ['required', 'in:xlsx,csv,pdf,json'],
            'period' => ['required', 'string'],
            'row_count' => ['sometimes', 'required', 'integer', 'min:0'],
            'filters' => ['sometimes', 'array'],
        ]);
        if ($validator->fails()) {
            return Api::fail('Invalid export log payload.', 422, $validator->errors()->toArray());
        }
        $input = $validator->validated() + ['row_count' => 0];
        $actor = Api::actor($request);
        $id = Api::id('exp');
        $now = Api::now();

        DB::transaction(function () use ($input, $actor, $id, $now): void {
            Sql::run(<<<'SQL'
                INSERT INTO export_logs (id, export_type, format, period, filters_json, row_count, status, user_id, user_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
                SQL, [
                $id, $input['export_type'], $input['format'], $input['period'],
                json_encode((object) ($input['filters'] ?? []), JSON_THROW_ON_ERROR),
                $input['row_count'], $actor['id'], $actor['name'], $now,
            ]);
            Api::audit($actor, 'report.exported', 'export_log', $id, [
                'export_type' => $input['export_type'], 'format' => $input['format'],
                'period' => $input['period'], 'row_count' => $input['row_count'],
            ]);
        });

        return Api::ok('Export logged.', ['id' => $id, 'created_at' => $now], null, 201);
    }

    private function range(string $period): array
    {
        $today = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $start = match ($period) {
            'weekly' => $today->modify('-6 days'),
            'monthly' => $today->modify('first day of this month'),
            'annually' => $today->setDate((int) $today->format('Y'), 1, 1),
            default => $today,
        };
        $label = match ($period) {
            'weekly' => 'Weekly ('.$start->format('Y-m-d').' to '.$today->format('Y-m-d').')',
            'monthly' => 'Monthly ('.$start->format('Y-m').')',
            'annually' => 'Annual ('.$start->format('Y').')',
            default => 'Daily ('.$start->format('Y-m-d').')',
        };

        return [
            $start->setTime(0, 0)->format('Y-m-d\TH:i:s.v\Z'),
            $today->setTime(23, 59, 59, 999000)->format('Y-m-d\TH:i:s.v\Z'),
            $label,
        ];
    }

    private function sales(array $dates): array
    {
        $saleDateRange = Sql::dateRange('s.created_at');
        $totals = Sql::one(<<<SQL
            SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS sales_count,
                   COALESCE(SUM(CASE WHEN source = 'preorder_fulfillment' THEN 1 ELSE 0 END), 0) AS preorder_fulfillments
            FROM sales s
            WHERE status <> 'returned' AND {$saleDateRange}
            SQL, $dates);
        $revenue = round((float) $totals['revenue'], 2);
        $saleCount = (int) $totals['sales_count'];

        return [
            'total_revenue' => $revenue,
            'sales_count' => $saleCount,
            'average_ticket' => $saleCount > 0 ? round($revenue / $saleCount, 2) : 0,
            'preorder_fulfillments' => (int) $totals['preorder_fulfillments'],
            'by_payment_method' => Sql::all(<<<SQL
                SELECT COALESCE(payment_method, 'cash') AS payment_method, COUNT(*) AS count, CAST(ROUND(CAST(SUM(total) AS NUMERIC), 2) AS DOUBLE PRECISION) AS revenue
                FROM sales s
                WHERE status <> 'returned' AND {$saleDateRange}
                GROUP BY 1 ORDER BY MAX(created_at) DESC
                SQL, $dates),
            'top_products' => Sql::all(<<<SQL
                SELECT MAX(si.product_name) AS product_name, si.sku, CAST(ROUND(CAST(SUM(si.quantity_base) AS NUMERIC), 4) AS DOUBLE PRECISION) AS quantity_base,
                       CAST(ROUND(CAST(SUM(si.line_total) AS NUMERIC), 2) AS DOUBLE PRECISION) AS revenue
                FROM sale_items si JOIN sales s ON s.id = si.sale_id
                JOIN products p ON p.id = si.product_id JOIN categories c ON c.id = p.category_id
                WHERE s.status <> 'returned' AND {$saleDateRange}
                GROUP BY si.sku ORDER BY revenue DESC LIMIT 12
                SQL, $dates),
            'recent_sales' => Sql::all(<<<SQL
                SELECT s.id, s.sale_number, COALESCE(u.name, 'Cashier') AS cashier_name, s.terminal_id,
                       s.payment_method, s.source, s.status, s.total, s.created_at
                FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
                WHERE s.status <> 'returned' AND {$saleDateRange}
                ORDER BY s.created_at DESC LIMIT 50
                SQL, $dates),
        ];
    }

    private function loans(array $dates): array
    {
        $loanDateRange = Sql::dateRange('COALESCE(l.disbursed_at, l.created_at)');
        $rows = Sql::all(<<<SQL
            SELECT l.id, l.loan_number, sp.first_name || ' ' || sp.last_name AS shareholder_name,
                   sp.membership_number, l.principal, l.interest_amount, l.term_months, l.status, l.created_at,
                   COALESCE(SUM(i.fees_due), 0) AS total_fees, COALESCE(SUM(i.amount_paid), 0) AS amount_paid
            FROM loans l JOIN shareholder_profiles sp ON sp.id = l.shareholder_id
            LEFT JOIN loan_installments i ON i.loan_id = l.id
            WHERE {$loanDateRange}
            GROUP BY l.id, sp.first_name, sp.last_name, sp.membership_number ORDER BY l.created_at DESC
            SQL, $dates);
        $byStatus = [];
        $principal = $interest = $collected = $outstanding = 0;
        foreach ($rows as &$loan) {
            $status = $loan['status'];
            $totalPayable = round($loan['principal'] + $loan['interest_amount'] + $loan['total_fees'], 2);
            $loan['total_paid'] = round((float) $loan['amount_paid'], 2);
            $loan['outstanding_balance'] = round(max(0, $totalPayable - $loan['total_paid']), 2);
            unset($loan['total_fees'], $loan['amount_paid']);
            $principal += $loan['principal'];
            $interest += $loan['interest_amount'];
            $collected += $loan['total_paid'];
            $outstanding += $loan['outstanding_balance'];
            $byStatus[$status] ??= ['status' => $status, 'count' => 0, 'principal' => 0];
            $byStatus[$status]['count']++;
            $byStatus[$status]['principal'] = round($byStatus[$status]['principal'] + $loan['principal'], 2);
        }

        return [
            'total_loans' => count($rows),
            'active_loans' => ($byStatus['active']['count'] ?? 0) + ($byStatus['disbursed']['count'] ?? 0),
            'overdue_loans' => $byStatus['overdue']['count'] ?? 0,
            'fully_paid_loans' => $byStatus['fully_paid']['count'] ?? 0,
            'total_principal' => round($principal, 2),
            'total_interest' => round($interest, 2),
            'total_collected' => round($collected, 2),
            'total_outstanding' => round($outstanding, 2),
            'by_status' => array_values($byStatus),
            'loans' => $rows,
        ];
    }
}
