<?php

namespace App\Support;

use Carbon\CarbonImmutable;

class LoanLedger
{
    public static function installments(string $loanId): array
    {
        return Sql::all('SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY installment_number', [$loanId]);
    }

    public static function payments(string $loanId): array
    {
        return Sql::all('SELECT * FROM loan_payments WHERE loan_id = ? ORDER BY payment_date DESC', [$loanId]);
    }

    public static function totals(array $loan, array $installments): array
    {
        $payable = round($loan['principal'] + $loan['interest_amount'] + array_sum(array_column($installments, 'fees_due')), 2);
        $paid = round(array_sum(array_column($installments, 'amount_paid')), 2);

        return [
            'computed_total_payable' => $payable,
            'computed_total_paid' => $paid,
            'computed_balance' => round(max(0, $payable - $paid), 2),
        ];
    }

    public static function hydrate(array $loan): array
    {
        $installments = self::installments($loan['id']);

        return [
            ...$loan,
            'installments' => $installments,
            'payments' => self::payments($loan['id']),
            ...self::totals($loan, $installments),
        ];
    }

    public static function schedule(array $loan, string $start): array
    {
        $term = (int) $loan['term_months'];
        $principalCents = (int) round($loan['principal'] * 100);
        $interestCents = (int) round($loan['principal'] * $loan['interest_rate'] * 100);
        $monthlyPrincipal = intdiv($principalCents, $term);
        $monthlyInterest = intdiv($interestCents, $term);
        $startDate = CarbonImmutable::parse($start)->utc();
        $installments = [];

        for ($number = 1; $number <= $term; $number++) {
            $principalDue = $number === $term ? $principalCents - ($term - 1) * $monthlyPrincipal : $monthlyPrincipal;
            $interestDue = $number === $term ? $interestCents - ($term - 1) * $monthlyInterest : $monthlyInterest;
            $installments[] = [
                'id' => "{$loan['id']}-inst-{$number}",
                'loan_id' => $loan['id'],
                'installment_number' => $number,
                'due_date' => $startDate->addMonthsWithOverflow($number)->toDateString(),
                'principal_due' => $principalDue / 100,
                'interest_due' => $interestDue / 100,
                'fees_due' => 0,
                'amount_due' => ($principalDue + $interestDue) / 100,
                'principal_paid' => 0,
                'interest_paid' => 0,
                'fees_paid' => 0,
                'amount_paid' => 0,
                'status' => 'pending',
                'paid_at' => null,
            ];
        }

        return $installments;
    }

    public static function allocate(array $installments, float $amount, string $now): array
    {
        $remaining = (int) round($amount * 100);
        $allocations = [];
        $updates = [];

        // The caller loads installments in order. Fees and interest clear before principal.
        foreach ($installments as $installment) {
            if ($remaining <= 0 || $installment['status'] === 'paid') {
                $updates[] = $installment;
                continue;
            }

            $allocation = ['installment_id' => $installment['id']];
            $applied = 0;
            $totalPaid = 0;
            $totalDue = 0;
            foreach (['fees', 'interest', 'principal'] as $component) {
                $due = (int) round($installment[$component.'_due'] * 100);
                $paid = (int) round($installment[$component.'_paid'] * 100);
                $appliedHere = min($remaining, max(0, $due - $paid));
                $remaining -= $appliedHere;
                $applied += $appliedHere;
                $totalPaid += $paid + $appliedHere;
                $totalDue += $due;
                $allocation[$component.'_paid'] = $appliedHere / 100;
                $installment[$component.'_paid'] = ($paid + $appliedHere) / 100;
            }

            $installment['amount_paid'] = $totalPaid / 100;
            if ($totalPaid >= $totalDue) {
                $installment['status'] = 'paid';
                $installment['paid_at'] = $now;
            } elseif ($totalPaid > 0 && $installment['status'] !== 'overdue') {
                $installment['status'] = 'partial';
            }

            if ($applied > 0) {
                $allocations[] = $allocation;
            }
            $updates[] = $installment;
        }

        return ['installments' => $updates, 'allocations' => $allocations, 'remaining' => $remaining / 100];
    }

    public static function portfolio(string $shareholderId): ?array
    {
        $shareholder = Sql::one('SELECT * FROM shareholder_profiles WHERE id = ?', [$shareholderId]);
        if ($shareholder === null) {
            return null;
        }

        $capital = Membership::capital($shareholderId);
        $capitalSettings = Sql::one('SELECT * FROM share_capital_settings LIMIT 1');
        $loanSettings = Sql::one('SELECT * FROM loan_settings LIMIT 1');
        $loanSettings = [
            'capital_multiplier' => (float) ($loanSettings['capital_multiplier'] ?? 6),
            'interest_rate' => (float) ($loanSettings['interest_rate'] ?? 0.06),
            'default_term_months' => (int) ($loanSettings['default_term_months'] ?? 6),
            'waiting_period_days' => (int) ($loanSettings['waiting_period_days'] ?? 7),
            'required_initial_capital' => (float) ($capitalSettings['required_initial_capital'] ?? 5000),
            'currency' => (string) ($capitalSettings['currency'] ?? 'PHP'),
        ];
        $loans = array_map(self::hydrate(...), Sql::all(<<<'SQL'
            SELECT l.*, sp.first_name || ' ' || sp.last_name AS shareholder_name, sp.membership_number
            FROM loans l JOIN shareholder_profiles sp ON sp.id = l.shareholder_id
            WHERE l.shareholder_id = ? ORDER BY l.created_at DESC
            SQL, [$shareholderId]));
        $applications = Sql::all(
            'SELECT * FROM loan_applications WHERE shareholder_id = ? ORDER BY created_at DESC',
            [$shareholderId],
        );
        $restriction = Sql::one('SELECT * FROM loan_eligibility WHERE shareholder_id = ?', [$shareholderId]);
        $evaluation = self::evaluate($shareholder, $capital['computed']['paidAmount'] ?? 0, $loanSettings, $loans, $applications, $restriction);

        return compact('evaluation', 'loans', 'applications', 'loanSettings');
    }

    private static function evaluate(array $shareholder, float $paid, array $settings, array $loans, array $applications, ?array $restriction): array
    {
        $active = array_filter($loans, static fn (array $loan) => $loan['status'] !== 'fully_paid');
        $pending = array_filter($applications, static fn (array $application) => in_array($application['status'], ['submitted', 'under_review'], true));
        $hasCompleted = count($loans) > count($active);
        $hasOverdue = false;
        $firstInstallmentsPaid = true;
        foreach ($active as $loan) {
            $hasOverdue = $hasOverdue || in_array('overdue', array_column($loan['installments'], 'status'), true);
            $firstInstallmentsPaid = $firstInstallmentsPaid && ($loan['installments'][0]['status'] ?? '') === 'paid';
        }

        $required = $settings['required_initial_capital'];
        $multiplier = $settings['capital_multiplier'];
        $maximum = round($paid * $multiplier, 2);
        $credit = round(max(0, $maximum - array_sum(array_column($active, 'computed_balance')) - array_sum(array_column($pending, 'requested_amount'))), 2);
        $statuses = array_column($active, 'status');
        $stage = match (true) {
            $hasCompleted && $active === [] && $pending === [] => 'HIGHER_LOAN_PRIVILEGE',
            in_array('active', $statuses, true) => $firstInstallmentsPaid ? 'REAPPLICATION_ALLOWED' : 'ACTIVE_LOAN',
            in_array('disbursed', $statuses, true) => 'DISBURSED',
            in_array('approved', $statuses, true) => 'APPROVED',
            $pending !== [] => 'APPLICATION_SUBMITTED',
            default => 'ELIGIBLE',
        };

        $evaluation = [
            'eligible' => true,
            'available_at' => null,
            'maximum_loan' => $maximum,
            'available_credit' => $credit,
            'verified_capital' => $paid,
            'capital_multiplier' => $multiplier,
            'currency' => $settings['currency'],
            'stage' => $stage,
            'reapplication_allowed' => true,
            'higher_loan_privilege' => $hasCompleted,
            'withdrawal_blocked' => false,
            'has_active_loan' => $active !== [],
            'has_overdue_installment' => $hasOverdue,
        ];

        $waitingUntil = $restriction['next_eligible_at'] ?? null;
        $blocked = match (true) {
            !Membership::canAccessLoans($shareholder, $paid, $required) => [
                'reason' => 'Membership verification and full initial share capital payment are required.',
                'stage' => 'MEMBERSHIP',
                'maximum_loan' => 0,
                'available_credit' => 0,
                'higher_loan_privilege' => false,
            ],
            (bool) ($restriction['withdrawal_blocked'] ?? false) || $hasOverdue => [
                'reason' => ($restriction['restriction_reason'] ?? '') ?: 'Loan withdrawal privileges are suspended due to an overdue installment.',
                'stage' => 'WITHDRAWAL_SUSPENDED',
                'withdrawal_blocked' => true,
                'available_at' => $waitingUntil,
            ],
            $waitingUntil !== null && strtotime($waitingUntil) > time() => [
                'reason' => "{$settings['waiting_period_days']}-day waiting period after overdue settlement is active.",
                'stage' => 'WAITING_PERIOD',
                'available_at' => $waitingUntil,
            ],
            $credit <= 0 => ['reason' => "Loan credit ceiling ({$multiplier} × verified share capital) has been reached."],
            default => null,
        };

        return $blocked === null ? $evaluation : [
            ...$evaluation,
            ...$blocked,
            'eligible' => false,
            'reapplication_allowed' => false,
        ];
    }
}
