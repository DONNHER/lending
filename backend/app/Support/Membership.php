<?php

namespace App\Support;

class Membership
{
    public static function forUser(string $userId): ?array
    {
        return Sql::one('SELECT * FROM shareholder_profiles WHERE user_id = ?', [$userId]);
    }

    public static function isStaff(array $actor): bool
    {
        return in_array($actor['role'], ['admin', 'manager', 'cashier'], true);
    }

    public static function capital(string $shareholderId): ?array
    {
        $account = Sql::one('SELECT * FROM share_capital_accounts WHERE shareholder_id = ?', [$shareholderId]);
        if ($account === null) {
            return null;
        }

        $payments = Sql::all(
            'SELECT * FROM share_capital_payments WHERE capital_account_id = ? ORDER BY created_at DESC',
            [$account['id']],
        );
        $account['required_amount'] = (float) $account['required_amount'];
        $computed = self::capitalStatus($account['required_amount'], $payments);
        $account['paid_amount'] = $computed['paidAmount'];
        $account['status'] = $computed['status'];

        return compact('account', 'payments', 'computed');
    }

    public static function capitalStatus(float $requiredAmount, array $payments): array
    {
        $verified = array_filter($payments, static fn (array $payment) => $payment['status'] === 'verified');
        $paid = round(array_sum(array_column($verified, 'amount')), 2);
        $status = match (true) {
            $requiredAmount > 0 && $paid >= $requiredAmount => 'paid',
            $paid > 0 => 'partial',
            default => 'unpaid',
        };

        return [
            'paidAmount' => $paid,
            'remainingAmount' => round(max(0, $requiredAmount - $paid), 2),
            'status' => $status,
        ];
    }
}
