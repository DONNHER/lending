<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\LoanLedger;
use App\Support\Membership;
use App\Support\Sql;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class LoansController extends Controller
{
    public function eligibility(Request $request): JsonResponse
    {
        $actor = Api::actor($request);
        $shareholderId = $request->query('shareholder_id');
        $shareholderId = is_string($shareholderId) ? $shareholderId : null;
        if (!$shareholderId) {
            $profile = Membership::forUser($actor['id']);
            if ($profile === null) {
                return Api::fail('No shareholder profile attached to this user.', 404);
            }
            $shareholderId = $profile['id'];
        } elseif (!Membership::isStaff($actor) && (Membership::forUser($actor['id'])['id'] ?? null) !== $shareholderId) {
            return Api::fail('You do not have permission to view another shareholder’s eligibility.', 403);
        }

        $portfolio = LoanLedger::portfolio($shareholderId);

        return $portfolio === null
            ? Api::fail('Shareholder not found.', 404)
            : Api::ok('Loan eligibility evaluated.', $portfolio['evaluation']);
    }

    public function dashboard(Request $request): JsonResponse
    {
        $actor = Api::actor($request);
        if (in_array($actor['role'], ['manager', 'admin'], true)) {
            $applications = Sql::all(<<<'SQL'
                SELECT la.*, sp.first_name || ' ' || sp.last_name AS shareholder_name, sp.membership_number
                FROM loan_applications la JOIN shareholder_profiles sp ON sp.id = la.shareholder_id
                ORDER BY la.created_at DESC
                SQL);
            $loans = array_map(LoanLedger::hydrate(...), Sql::all(<<<'SQL'
                SELECT l.*, sp.first_name || ' ' || sp.last_name AS shareholder_name, sp.membership_number
                FROM loans l JOIN shareholder_profiles sp ON sp.id = l.shareholder_id
                ORDER BY l.created_at DESC
                SQL));

            return Api::ok('Manager loan portfolio retrieved.', [
                'mode' => 'manager',
                'applications' => $applications,
                'loans' => $loans,
                'loanSettings' => Sql::one('SELECT * FROM loan_settings LIMIT 1'),
                'capSettings' => Sql::one('SELECT * FROM share_capital_settings LIMIT 1'),
            ]);
        }

        $shareholder = Membership::forUser($actor['id']);
        if ($shareholder === null) {
            return Api::fail('Shareholder profile required for loans.', 403);
        }

        $portfolio = LoanLedger::portfolio($shareholder['id']);
        if ($portfolio === null || $portfolio['evaluation']['stage'] === 'MEMBERSHIP') {
            return Api::fail('Complete membership approval and verified share capital to access Loans.', 403);
        }

        return Api::ok('Shareholder loan dashboard retrieved.', [
            'mode' => 'shareholder',
            'shareholder' => $shareholder,
            ...$portfolio,
        ]);
    }

    public function myApplications(Request $request): JsonResponse
    {
        $shareholder = Membership::forUser(Api::actor($request)['id']);
        if ($shareholder === null) {
            return Api::fail('Shareholder profile required.', 403);
        }
        $applications = Sql::all('SELECT * FROM loan_applications WHERE shareholder_id = ? ORDER BY created_at DESC', [$shareholder['id']]);
        foreach ($applications as &$application) {
            $application['reviews'] = $this->reviews($application['id']);
        }

        return Api::ok('Shareholder loan applications retrieved.', $applications);
    }

    public function apply(Request $request): JsonResponse
    {
        $actor = Api::actor($request);
        $shareholder = Membership::forUser($actor['id']);
        if ($shareholder === null) {
            return Api::fail('Only shareholders can apply for cooperative loans.', 403);
        }
        $fields = $request->validate([
            'requested_amount' => ['required', 'numeric', 'gt:0'],
            'term_months' => ['required', 'integer', 'between:1,24'],
            'purpose' => ['required', 'string', 'min:5'],
        ]);
        $amount = (float) $fields['requested_amount'];

        return Sql::serialized(Sql::LOAN_WRITES, function () use ($actor, $shareholder, $fields, $amount) {
            $portfolio = LoanLedger::portfolio($shareholder['id']);
            if ($portfolio === null) {
                return Api::fail('Shareholder not found.', 404);
            }
            $evaluation = $portfolio['evaluation'];
            if (!$evaluation['eligible']) {
                return Api::fail($evaluation['reason'], 422, ['requested_amount' => [$evaluation['reason']]]);
            }
            if ($amount > $evaluation['available_credit']) {
                $limit = number_format($evaluation['available_credit'], 2);

                return Api::fail('Requested amount exceeds available loan ceiling.', 422, [
                    'requested_amount' => ["Requested PHP {$amount} exceeds available credit of PHP {$limit}."],
                ]);
            }

            $id = Api::id('app');
            DB::table('loan_applications')->insert([
                'id' => $id,
                'shareholder_id' => $shareholder['id'],
                'requested_amount' => $amount,
                'term_months' => (int) $fields['term_months'],
                'purpose' => trim($fields['purpose']),
                'status' => 'submitted',
                'created_at' => Api::now(),
            ]);
            Api::audit($actor, 'loan_application.submitted', 'loan_application', $id, ['amount' => $amount]);

            return Api::ok('Loan application submitted for manager review.', ['id' => $id], null, 201);
        }, 3);
    }

    public function review(Request $request, string $id): JsonResponse
    {
        $validation = Validator::make($request->all(), [
            'decision' => ['required', 'in:approved,rejected'],
            'remarks' => ['nullable', 'string'],
        ]);
        if ($validation->fails()) {
            return Api::fail('Invalid review decision.', 422);
        }
        $fields = $validation->validated();
        $decision = $fields['decision'];
        $remarks = ($fields['remarks'] ?? '') ?: null;
        $actor = Api::actor($request);

        return Sql::serialized(Sql::LOAN_WRITES, function () use ($id, $actor, $decision, $remarks) {
            $application = Sql::one('SELECT * FROM loan_applications WHERE id = ?', [$id]);
            if ($application === null) {
                return Api::fail('Loan application not found.', 404);
            }
            if (!in_array($application['status'], ['submitted', 'under_review'], true)) {
                return Api::fail('Application has already been reviewed.', 400);
            }
            $now = Api::now();
            DB::table('loan_applications')->where('id', $id)->update([
                'status' => $decision,
                'reviewer_id' => $actor['id'],
                'reviewer_remarks' => $remarks,
                'reviewed_at' => $now,
            ]);
            DB::table('loan_reviews')->insert([
                'id' => Api::id('lrev'),
                'application_id' => $id,
                'manager_id' => $actor['id'],
                'decision' => $decision,
                'remarks' => $remarks,
                'created_at' => $now,
            ]);

            $loanId = null;
            if ($decision === 'approved') {
                $settings = Sql::one('SELECT interest_rate FROM loan_settings LIMIT 1');
                $rate = (float) ($settings['interest_rate'] ?? 0.06);
                $loanId = Api::id('loan');
                DB::table('loans')->insert([
                    'id' => $loanId,
                    'loan_number' => 'LN-'.substr($now, 0, 4).'-'.strtoupper(substr($loanId, 5)),
                    'shareholder_id' => $application['shareholder_id'],
                    'application_id' => $id,
                    'principal' => $application['requested_amount'],
                    'interest_rate' => $rate,
                    'interest_amount' => round($application['requested_amount'] * $rate, 2),
                    'term_months' => $application['term_months'],
                    'status' => 'approved',
                    'created_at' => $now,
                ]);
            }
            Api::audit($actor, "loan_application.{$decision}", 'loan_application', $id, ['created_loan_id' => $loanId]);

            return Api::ok("Loan application {$decision}.", ['application_id' => $id, 'status' => $decision, 'loan_id' => $loanId]);
        }, 3);
    }

    public function disburse(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);

        return Sql::serialized(Sql::LOAN_WRITES, function () use ($id, $actor) {
            $loan = Sql::one('SELECT * FROM loans WHERE id = ?', [$id]);
            if ($loan === null) {
                return Api::fail('Loan not found.', 404);
            }
            if ($loan['status'] !== 'approved') {
                return Api::fail('Only approved loans can be disbursed (transactional disbursement protection).', 409);
            }

            $now = Api::now();
            $reference = strtoupper(Api::id('DISB'));
            $installments = LoanLedger::schedule($loan, $now);
            DB::table('loans')->where('id', $id)->update([
                'status' => 'active',
                'disbursed_at' => $now,
                'disbursement_reference' => $reference,
            ]);
            DB::table('loan_disbursements')->insert([
                'id' => Api::id('ldisb'),
                'loan_id' => $id,
                'amount' => $loan['principal'],
                'reference' => $reference,
                'disbursed_by' => $actor['id'],
                'disbursed_at' => $now,
            ]);
            DB::table('loan_installments')->insert($installments);
            Api::audit($actor, 'loan.disbursed', 'loan', $id, ['reference' => $reference, 'principal' => $loan['principal']]);

            return Api::ok("Loan disbursed ({$reference}). Repayment schedule generated.", [
                'id' => $id,
                'disbursement_reference' => $reference,
                'installments' => $installments,
            ]);
        }, 3);
    }

    public function schedule(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);
        $loan = $this->loanWithOwner($id);
        if ($loan === null) {
            return Api::fail('Loan not found.', 404);
        }
        if (!Membership::isStaff($actor) && $loan['owner_user_id'] !== $actor['id']) {
            return Api::fail('You do not have permission to view this loan schedule.', 403);
        }

        $installments = LoanLedger::installments($id);

        return Api::ok('Loan repayment schedule retrieved.', [
            'loan_id' => $id,
            'loan_number' => $loan['loan_number'],
            'status' => $loan['status'],
            ...LoanLedger::totals($loan, $installments),
            'installments' => $installments,
        ]);
    }

    public function history(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);
        $loan = $this->loanWithOwner($id);
        if ($loan === null) {
            return Api::fail('Loan not found.', 404);
        }
        if (!Membership::isStaff($actor) && $loan['owner_user_id'] !== $actor['id']) {
            return Api::fail('You do not have permission to view this loan history.', 403);
        }
        unset($loan['owner_user_id']);

        $installments = LoanLedger::installments($id);
        $payments = LoanLedger::payments($id);
        foreach ($payments as &$payment) {
            $payment['allocations'] = Sql::all('SELECT * FROM loan_payment_allocations WHERE payment_id = ?', [$payment['id']]);
        }

        return Api::ok('Loan history retrieved.', [
            'loan' => [...$loan, ...LoanLedger::totals($loan, $installments)],
            'application' => Sql::one('SELECT * FROM loan_applications WHERE id = ?', [$loan['application_id']]),
            'reviews' => $this->reviews($loan['application_id']),
            'disbursements' => Sql::all('SELECT * FROM loan_disbursements WHERE loan_id = ? ORDER BY disbursed_at DESC', [$id]),
            'payments' => $payments,
            'installments' => $installments,
        ]);
    }

    public function payment(Request $request, string $id): JsonResponse
    {
        if ($request->attributes->has('argivit.impersonator')) {
            return Api::fail('A manager must sign in directly to record repayments.', 403);
        }
        $actor = Api::actor($request);
        $validation = Validator::make($request->all(), [
            'amount' => ['required', 'numeric', 'gt:0'],
            'payment_method' => ['sometimes', 'required', 'in:cash,gcash,bank_transfer'],
            'reference' => ['required', 'string', 'min:3'],
        ]);
        if ($validation->fails()) {
            return Api::fail('Invalid loan payment.', 422, $validation->errors()->toArray());
        }
        $fields = $validation->validated();
        $amount = round((float) $fields['amount'], 2);
        $method = $fields['payment_method'] ?? 'cash';
        $reference = trim($fields['reference']);

        return Sql::serialized(Sql::LOAN_WRITES, function () use ($id, $actor, $amount, $method, $reference) {
            $loan = Sql::one('SELECT * FROM loans WHERE id = ?', [$id]);
            if ($loan === null) {
                return Api::fail('Loan not found.', 404);
            }
            if (in_array($loan['status'], ['fully_paid', 'approved'], true)) {
                return Api::fail('Payments can only be posted to disbursed/active loans.', 400);
            }
            $installments = LoanLedger::installments($id);
            $now = Api::now();
            $allocation = LoanLedger::allocate($installments, $amount, $now);
            if ($allocation['allocations'] === [] || $allocation['remaining'] > 0) {
                return Api::fail('Enter a positive payment within the outstanding loan balance.', 422, [
                    'amount' => ['Payment must be fully allocatable to this loan.'],
                ]);
            }

            $paymentId = Api::id('lpay');
            DB::table('loan_payments')->insert([
                'id' => $paymentId,
                'loan_id' => $id,
                'amount' => $amount,
                'payment_date' => $now,
                'payment_method' => $method,
                'reference' => $reference,
                'recorded_by' => $actor['id'],
            ]);
            DB::table('payments')->insert([
                'id' => "pay-{$paymentId}",
                'transaction_type' => 'loan_repayment',
                'transaction_id' => $paymentId,
                'amount' => $amount,
                'payment_method' => $method,
                'reference' => $reference,
                'created_at' => $now,
            ]);

            $changedIds = array_column($allocation['allocations'], 'installment_id');
            foreach ($allocation['installments'] as $installment) {
                if (in_array($installment['id'], $changedIds, true)) {
                    DB::table('loan_installments')->where('id', $installment['id'])->update(array_intersect_key($installment, array_flip([
                        'principal_paid', 'interest_paid', 'fees_paid', 'amount_paid', 'status', 'paid_at',
                    ])));
                }
            }
            foreach ($allocation['allocations'] as $item) {
                DB::table('loan_payment_allocations')->insert(['id' => Api::id('lpa'), 'payment_id' => $paymentId, ...$item]);
            }

            $states = array_unique(array_column($allocation['installments'], 'status'));
            $allPaid = $states === ['paid'];
            $stillOverdue = in_array('overdue', $states, true);
            $status = $allPaid ? 'fully_paid' : ($stillOverdue ? 'overdue' : 'active');
            DB::table('loans')->where('id', $id)->update(['status' => $status, 'completed_at' => $allPaid ? $now : null]);

            if (in_array('overdue', array_column($installments, 'status'), true) && !$stillOverdue) {
                $anyOverdue = Sql::one(<<<'SQL'
                    SELECT li.id FROM loan_installments li JOIN loans l ON l.id = li.loan_id
                    WHERE l.shareholder_id = ? AND li.status = 'overdue' LIMIT 1
                    SQL, [$loan['shareholder_id']]);
                if ($anyOverdue === null) {
                    $days = (int) (Sql::one('SELECT waiting_period_days FROM loan_settings LIMIT 1')['waiting_period_days'] ?? 7);
                    DB::table('loan_eligibility')->updateOrInsert(['shareholder_id' => $loan['shareholder_id']], [
                        'withdrawal_blocked' => 0,
                        'restriction_reason' => "Settled overdue installment — {$days}-day cooling period",
                        'next_eligible_at' => CarbonImmutable::parse($now)->utc()->addDays($days)->format('Y-m-d\TH:i:s.v\Z'),
                        'updated_at' => $now,
                    ]);
                }
            }

            Api::audit($actor, 'loan.payment_posted', 'loan', $id, ['amount' => $amount, 'new_status' => $status]);

            return Api::ok('Loan payment allocated to ledger.', [
                'payment_id' => $paymentId,
                'allocations' => $allocation['allocations'],
                'all_paid' => $allPaid,
            ], null, 201);
        }, 3);
    }

    public function overdue(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);

        return Sql::serialized(Sql::LOAN_WRITES, function () use ($id, $actor) {
            $loan = Sql::one('SELECT * FROM loans WHERE id = ?', [$id]);
            if ($loan === null) {
                return Api::fail('Loan not found.', 404);
            }
            $next = Sql::one("SELECT id FROM loan_installments WHERE loan_id = ? AND status IN ('pending', 'partial') ORDER BY installment_number LIMIT 1", [$id]);
            if ($next === null) {
                return Api::fail('No pending installment to mark overdue.', 400);
            }

            DB::table('loan_installments')->where('id', $next['id'])->update(['status' => 'overdue']);
            DB::table('loans')->where('id', $id)->update(['status' => 'overdue']);
            DB::table('loan_eligibility')->updateOrInsert(['shareholder_id' => $loan['shareholder_id']], [
                'withdrawal_blocked' => 1,
                'restriction_reason' => 'Missed scheduled loan installment — withdrawal suspended',
                'next_eligible_at' => null,
                'updated_at' => Api::now(),
            ]);
            Api::audit($actor, 'loan.marked_overdue', 'loan', $id, ['installment_id' => $next['id']]);

            return Api::ok('Installment marked overdue and loan withdrawal suspended.', ['loan_id' => $id]);
        }, 3);
    }

    private function loanWithOwner(string $id): ?array
    {
        return Sql::one(<<<'SQL'
            SELECT l.*, sp.user_id AS owner_user_id, sp.first_name || ' ' || sp.last_name AS shareholder_name, sp.membership_number
            FROM loans l JOIN shareholder_profiles sp ON sp.id = l.shareholder_id WHERE l.id = ?
            SQL, [$id]);
    }

    private function reviews(string $applicationId): array
    {
        return Sql::all(<<<'SQL'
            SELECT lr.*, u.name AS manager_name FROM loan_reviews lr JOIN users u ON u.id = lr.manager_id
            WHERE lr.application_id = ? ORDER BY lr.created_at DESC
            SQL, [$applicationId]);
    }
}
