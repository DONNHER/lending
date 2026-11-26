<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class NotificationInbox
{
    public const KINDS = ['system', 'warning', 'critical', 'reminder'];

    public static function add(string $userId, string $key, string $kind, string $title, string $message): void
    {
        $enabled = DB::table('notification_preferences')->where('user_id', $userId)->where('kind', $kind)->value('enabled');
        if ($enabled !== null && !(bool) $enabled) {
            return;
        }

        DB::table('user_notifications')->insertOrIgnore([
            'id' => (string) Str::uuid(), 'user_id' => $userId, 'event_key' => $key,
            'kind' => $kind, 'title' => $title, 'message' => $message, 'created_at' => Api::now(),
        ]);
    }

    public static function onAudit(string $event, string $action, string $entityId): void
    {
        if ($action === 'auth.suspicious_activity') {
            self::operators(['admin'], $event, 'critical', 'Repeated failed sign-in attempts',
                'Review suspicious activity in the audit log.');
        } elseif ($action === 'system.backup_failed') {
            self::operators(['admin'], $event, 'critical', 'Backup failed',
                'Review the backup log for the latest attempt.');
        } elseif (in_array($action, ['shareholder.approved', 'shareholder.rejected'], true)) {
            $userId = DB::table('shareholder_profiles')->where('id', $entityId)->value('user_id');
            if ($userId !== null) {
                self::add($userId, $event, 'system', 'Membership review updated', 'Open Membership to view the decision.');
            }
        } elseif (in_array($action, ['loan_application.approved', 'loan_application.rejected'], true)) {
            $userId = DB::table('loan_applications as a')->join('shareholder_profiles as sp', 'sp.id', '=', 'a.shareholder_id')
                ->where('a.id', $entityId)->value('sp.user_id');
            if ($userId !== null) {
                self::add($userId, $event, 'system', 'Loan application reviewed', 'Open Loans to view the decision.');
            }
        }
    }

    public static function scheduled(): void
    {
        $today = CarbonImmutable::today('Asia/Manila');
        $date = $today->toDateString();
        $outOfStock = DB::table('inventory_balances as i')->join('products as p', 'p.id', '=', 'i.product_id')
            ->where('p.status', 'active')->where('i.quantity_base', '<=', 0)->count();
        if ($outOfStock > 0) {
            self::operators(['admin', 'manager'], 'stock-'.$date, 'warning', 'Products out of stock',
                "Inventory has {$outOfStock} active products with zero available stock.");
        }

        $capacity = disk_total_space(storage_path());
        $available = disk_free_space(storage_path());
        if ($capacity !== false && $capacity > 0 && $available !== false && 1 - $available / $capacity >= .85) {
            self::operators(['admin'], 'storage-'.$date, 'warning', 'Server storage above 85%',
                'Review backup files and expired archives to free up space.');
        }

        $due = DB::table('loan_installments as i')->join('loans as l', 'l.id', '=', 'i.loan_id')
            ->join('shareholder_profiles as sp', 'sp.id', '=', 'l.shareholder_id')
            ->join('users as u', 'u.id', '=', 'sp.user_id')
            ->whereIn('i.status', ['pending', 'partial'])->where('u.account_status', 'active')
            ->whereBetween('i.due_date', [$date, $today->addDays(4)->toDateString()])
            ->get(['i.id', 'i.due_date', 'u.id as user_id']);
        foreach ($due as $installment) {
            self::add($installment->user_id, 'loan-due-'.$installment->id, 'reminder', 'Upcoming loan installment',
                'An installment is due on '.substr($installment->due_date, 0, 10).'. View Loans for details.');
        }
    }

    private static function operators(array $roles, string $key, string $kind, string $title, string $message): void
    {
        $users = DB::table('users')->whereIn('role', $roles)->where('account_status', 'active')->pluck('id');
        foreach ($users as $id) {
            self::add($id, $key, $kind, $title, $message);
        }
    }
}
