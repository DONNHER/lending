<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Membership;
use App\Support\Sql;
use App\Support\VerificationDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class ShareholdersController extends Controller
{
    public function index(): JsonResponse
    {
        $profiles = Sql::all(<<<'SQL'
            SELECT sp.*, u.email, u.name AS user_name
            FROM shareholder_profiles sp JOIN users u ON u.id = sp.user_id
            ORDER BY sp.created_at DESC
            SQL);
        foreach ($profiles as &$profile) {
            $profile = [...$profile, ...$this->membershipDetails($profile['id'])];
        }

        return Api::ok('Shareholders retrieved.', $profiles);
    }

    public function register(Request $request): JsonResponse
    {
        $actor = Api::actor($request);
        if (Membership::forUser($actor['id']) !== null) {
            return Api::fail('A shareholder profile already exists for this account.', 409);
        }
        $fields = $this->profileFields($request);

        return DB::transaction(function () use ($actor, $fields) {
            if (Membership::forUser($actor['id']) !== null) {
                return Api::fail('A shareholder profile already exists for this account.', 409);
            }
            $now = Api::now();
            $id = Api::id('sh');
            $number = 'ARG-SH-'.strtoupper(substr($id, 3));
            $required = Sql::one('SELECT required_initial_capital FROM share_capital_settings LIMIT 1')['required_initial_capital'] ?? 5000;
            DB::table('shareholder_profiles')->insert([
                ...$fields,
                'id' => $id,
                'user_id' => $actor['id'],
                'membership_number' => $number,
                'verification_status' => 'incomplete',
                'created_at' => $now,
            ]);
            DB::table('share_capital_accounts')->insert([
                'id' => Api::id('cap-acc'),
                'shareholder_id' => $id,
                'required_amount' => $required,
                'status' => 'unpaid',
                'created_at' => $now,
            ]);
            Api::audit($actor, 'shareholder.registered', 'shareholder_profile', $id, ['membership_number' => $number]);

            return Api::ok('Shareholder profile registered with fixed initial share capital requirement.', [
                'profile' => Membership::forUser($actor['id']),
                'capital_account' => Membership::capital($id)['account'],
            ], null, 201);
        }, 3);
    }

    public function me(Request $request): JsonResponse
    {
        $profile = Membership::forUser(Api::actor($request)['id']);
        if ($profile === null) {
            return Api::ok('No shareholder profile attached to this staff account.');
        }

        $details = $this->membershipDetails($profile['id']);
        $required = (float) (DB::table('share_capital_settings')->value('required_initial_capital') ?? 5000);

        return Api::ok('Shareholder profile retrieved.', [
            'profile' => $profile,
            ...$details,
            'required_share_capital' => $required,
            'loan_access' => Membership::canAccessLoans($profile, $details['capital_account']['paid_amount'] ?? 0, $required),
        ])->header('Cache-Control', 'private, no-store');
    }

    public function update(Request $request): JsonResponse
    {
        $profile = Membership::forUser(Api::actor($request)['id']);
        if ($profile === null) {
            return Api::fail('Shareholder profile not found.', 404);
        }
        $fields = $this->profileFields($request);

        return DB::transaction(function () use ($profile, $fields) {
            DB::table('shareholder_profiles')->where('id', $profile['id'])->update($fields);
            return Api::ok('Shareholder profile updated.', [
                'id' => $profile['id'],
                'verification_status' => DB::table('shareholder_profiles')->where('id', $profile['id'])->value('verification_status'),
            ]);
        }, 3);
    }

    public function submitDocument(Request $request): JsonResponse
    {
        $actor = Api::actor($request);
        $profile = Membership::forUser($actor['id']);
        if ($profile === null) {
            return Api::fail('Shareholder profile required.', 404);
        }
        $validation = Validator::make($request->all(), [
            'document_type' => ['required', Rule::in(Membership::LAND_DOCUMENT_TYPES)],
            'file' => ['required', 'file', 'mimetypes:application/pdf,image/jpeg,image/png', 'max:5120'],
        ]);
        if ($validation->fails()) {
            return Api::fail('Invalid document payload.', 422, $validation->errors()->toArray());
        }
        $fields = $validation->validated();
        $file = $fields['file'];
        $key = VerificationDocuments::objectKey($file);
        $filename = VerificationDocuments::originalName($file, $key);
        try {
            VerificationDocuments::store($key, $file);
        } catch (Throwable) {
            VerificationDocuments::discard($key);

            return Api::fail('Verification storage is temporarily unavailable. Please try again.', 503);
        }

        try {
            return DB::transaction(function () use ($actor, $profile, $fields, $key, $filename) {
                $id = Api::id('doc');
                DB::table('shareholder_documents')->insert([
                    'id' => $id,
                    'shareholder_id' => $profile['id'],
                    'document_type' => $fields['document_type'],
                    'file_name' => $filename,
                    'file_path' => $key,
                    'review_status' => 'pending',
                    'created_at' => Api::now(),
                ]);
                DB::table('shareholder_profiles')->where('id', $profile['id'])->whereIn('verification_status', ['incomplete', 'rejected'])
                    ->update(['verification_status' => 'pending_review']);
                Api::audit($actor, 'document.submitted', 'shareholder_document', $id, ['document_type' => $fields['document_type']]);

                return Api::ok('Verification document uploaded.', ['id' => $id], null, 201);
            }, 3);
        } catch (Throwable $error) {
            VerificationDocuments::discard($key);

            throw $error;
        }
    }

    public function downloadDocument(Request $request, string $id): JsonResponse|StreamedResponse
    {
        $actor = Api::actor($request);
        $document = Sql::one(<<<'SQL'
            SELECT d.file_path, d.file_name, sp.user_id
            FROM shareholder_documents d JOIN shareholder_profiles sp ON sp.id = d.shareholder_id
            WHERE d.id = ?
            SQL, [$id]);
        if ($document === null) {
            return Api::fail('Document not found.', 404);
        }
        if (!in_array($actor['role'], ['admin', 'manager'], true) && $document['user_id'] !== $actor['id']) {
            return Api::fail('You do not have permission to download this document.', 403);
        }

        try {
            $stream = VerificationDocuments::open($document['file_path']);
        } catch (Throwable) {
            return Api::fail('Verification storage is temporarily unavailable. Please try again.', 503);
        }
        if (!is_resource($stream)) {
            return Api::fail('This document has no stored attachment.', 404);
        }

        return response()->streamDownload(static function () use ($stream): void {
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, $document['file_name'], [
            'Content-Type' => 'application/octet-stream',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function documents(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);
        $profile = Sql::one('SELECT id, user_id FROM shareholder_profiles WHERE id = ?', [$id]);
        if ($profile === null) {
            return Api::fail('Shareholder not found.', 404);
        }
        if (!Membership::isStaff($actor) && $profile['user_id'] !== $actor['id']) {
            return Api::fail('You do not have permission to view these documents.', 403);
        }
        $documents = $this->documentRows($id);
        foreach ($documents as &$document) {
            $document['reviews'] = Sql::all(<<<'SQL'
                SELECT dr.*, u.name AS reviewer_name
                FROM document_reviews dr JOIN users u ON u.id = dr.reviewer_id
                WHERE dr.document_id = ? ORDER BY dr.created_at DESC
                SQL, [$document['id']]);
        }

        return Api::ok('Shareholder documents retrieved.', $documents);
    }

    public function reviewDocument(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);
        $validation = Validator::make($request->all(), [
            'decision' => ['required', 'in:approved,rejected'],
            'remarks' => ['nullable', 'string'],
        ]);
        if ($validation->fails()) {
            return Api::fail('Invalid review payload.', 422, $validation->errors()->toArray());
        }
        $fields = $validation->validated();
        $decision = $fields['decision'];
        $remarks = ($fields['remarks'] ?? '') ?: null;

        return DB::transaction(function () use ($actor, $id, $decision, $remarks) {
            $document = Sql::one('SELECT * FROM shareholder_documents WHERE id = ?', [$id]);
            if ($document === null) {
                return Api::fail('Document not found.', 404);
            }
            $now = Api::now();
            $target = DB::table('shareholder_documents')->where('id', $id);
            if (in_array($document['document_type'], Membership::LAND_DOCUMENT_TYPES, true)) {
                $target->where('review_status', 'pending');
            }
            $updated = $target->update([
                'review_status' => $decision,
                'reviewer_id' => $actor['id'],
                'reviewer_remarks' => $remarks,
                'reviewed_at' => $now,
            ]);
            if ($updated === 0) {
                return Api::fail('This land document has already been reviewed.', 409);
            }
            DB::table('document_reviews')->insert([
                'id' => Api::id('drev'),
                'document_id' => $id,
                'reviewer_id' => $actor['id'],
                'decision' => $decision,
                'remarks' => $remarks,
                'created_at' => $now,
            ]);
            Api::audit($actor, "document.{$decision}", 'shareholder_document', $id, ['shareholder_id' => $document['shareholder_id']]);

            return Api::ok("Document {$decision}.", ['id' => $id, 'review_status' => $decision]);
        }, 3);
    }

    public function verify(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);
        $validation = Validator::make($request->all(), ['decision' => ['required', 'in:approved,rejected']]);
        if ($validation->fails()) {
            return Api::fail('Invalid verification decision.', 422);
        }
        $decision = $validation->validated()['decision'];

        return DB::transaction(function () use ($actor, $id, $decision) {
            $profile = DB::table('shareholder_profiles')->where('id', $id)->lockForUpdate()->first(['verification_status']);
            if ($profile === null) {
                return Api::fail('Shareholder not found.', 404);
            }
            if ($decision === 'approved' && $profile->verification_status !== 'approved' && !Membership::hasApprovedLandPaper($id)) {
                return Api::fail('Review and approve an original or notarized land paper before approving membership.', 422);
            }

            DB::table('shareholder_profiles')->where('id', $id)->update([
                'verification_status' => $decision,
                'approved_at' => $decision === 'approved' ? Api::now() : null,
                'approved_by' => $decision === 'approved' ? $actor['id'] : null,
            ]);
            Api::audit($actor, "shareholder.{$decision}", 'shareholder_profile', $id);

            return Api::ok("Shareholder membership {$decision}.", ['id' => $id, 'verification_status' => $decision]);
        }, 3);
    }

    public function capital(Request $request): JsonResponse
    {
        $profile = Membership::forUser(Api::actor($request)['id']);

        return $profile === null
            ? Api::ok('No share capital account.')
            : Api::ok('Share capital ledger retrieved.', Membership::capital($profile['id']));
    }

    public function submitCapitalPayment(): JsonResponse
    {
        return Api::fail('Your cooperative manager records share capital payments.', 403);
    }

    public function recordCapitalPayment(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);
        $fields = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01'],
            'payment_method' => ['required', Rule::in(['cash', 'bank_transfer', 'gcash'])],
            'reference' => ['required', 'string', 'min:3', 'max:150'],
        ]);

        return DB::transaction(function () use ($actor, $id, $fields) {
            $account = $this->lockedCapitalAccount($id, byShareholder: true);
            if ($account === null) {
                return Api::fail('Share capital account not found.', 404);
            }
            if ($account->verification_status !== 'approved') {
                return Api::fail('Approve the membership before recording share capital.', 422);
            }

            $now = Api::now();
            $payment = [
                'id' => Api::id('cap-pay'),
                'capital_account_id' => $account->id,
                'reference' => trim($fields['reference']),
                'amount' => (float) $fields['amount'],
                'payment_method' => $fields['payment_method'],
                'status' => 'verified',
                'verified_by' => $actor['id'],
                'verified_at' => $now,
                'created_at' => $now,
            ];
            if (DB::table('share_capital_payments')->insertOrIgnore($payment) === 0) {
                return Api::fail('This payment reference has already been recorded.', 422, [
                    'reference' => ['This payment reference has already been recorded.'],
                ]);
            }

            $computed = $this->reconcileCapitalPayment($account, $payment, $actor, 'verified', $now);

            return Api::ok('Share capital payment recorded.', $computed, null, 201);
        }, 3);
    }

    public function verifyCapitalPayment(Request $request, string $id): JsonResponse
    {
        $actor = Api::actor($request);
        $validation = Validator::make($request->all(), ['decision' => ['required', 'in:verified,rejected']]);
        if ($validation->fails()) {
            return Api::fail('Invalid decision.', 422);
        }
        $decision = $validation->validated()['decision'];

        return DB::transaction(function () use ($actor, $id, $decision) {
            $payment = Sql::one('SELECT * FROM share_capital_payments WHERE id = ?', [$id]);
            if ($payment === null) {
                return Api::fail('Payment record not found.', 404);
            }
            $account = $this->lockedCapitalAccount($payment['capital_account_id']);
            if ($account === null) {
                return Api::fail('Share capital account not found.', 404);
            }
            if ($decision === 'verified' && $account->verification_status !== 'approved') {
                return Api::fail('Approve the membership before verifying share capital.', 422);
            }

            $now = Api::now();
            $updated = DB::table('share_capital_payments')->where('id', $id)->where('status', 'pending')->update([
                'status' => $decision,
                'verified_by' => $actor['id'],
                'verified_at' => $now,
            ]);
            if ($updated === 0) {
                return Api::fail('Payment has already been processed.', 400);
            }

            $computed = $this->reconcileCapitalPayment($account, $payment, $actor, $decision, $now);

            return Api::ok("Payment {$decision}. Account status: {$computed['status']}.", $computed);
        }, 3);
    }

    private function lockedCapitalAccount(string $id, bool $byShareholder = false): ?object
    {
        return DB::table('share_capital_accounts as account')
            ->join('shareholder_profiles as member', 'member.id', '=', 'account.shareholder_id')
            ->where($byShareholder ? 'account.shareholder_id' : 'account.id', $id)->lockForUpdate()
            ->first(['account.id', 'account.required_amount', 'account.fully_paid_at', 'member.verification_status']);
    }

    private function reconcileCapitalPayment(object $account, array $payment, array $actor, string $decision, string $now): array
    {
        $payments = Sql::all('SELECT amount, status FROM share_capital_payments WHERE capital_account_id = ?', [$account->id]);
        $computed = Membership::capitalStatus((float) $account->required_amount, $payments);
        DB::table('share_capital_accounts')->where('id', $account->id)->update([
            'status' => $computed['status'],
            'fully_paid_at' => $computed['status'] === 'paid' ? ($account->fully_paid_at ?? $now) : null,
        ]);

        $id = $payment['id'];
        if ($decision === 'verified') {
            DB::table('payments')->insertOrIgnore([
                'id' => "pay-{$id}",
                'transaction_type' => 'share_capital',
                'transaction_id' => $id,
                'amount' => $payment['amount'],
                'payment_method' => $payment['payment_method'],
                'reference' => $payment['reference'],
                'created_at' => $now,
            ]);
        }
        Api::audit($actor, "share_capital_payment.{$decision}", 'share_capital_payment', $id, [
            'amount' => $payment['amount'],
            'new_account_status' => $computed['status'],
        ]);

        return $computed;
    }

    private function profileFields(Request $request): array
    {
        $fields = $request->validate([
            'first_name' => ['required', 'string', 'min:1'],
            'middle_name' => ['nullable', 'string'],
            'last_name' => ['required', 'string', 'min:1'],
            'birth_date' => ['nullable', 'string'],
            'contact_number' => ['required', 'string', 'min:5'],
            'address' => ['required', 'string', 'min:5'],
        ]);

        return [
            'first_name' => trim($fields['first_name']),
            'middle_name' => trim($fields['middle_name'] ?? '') ?: null,
            'last_name' => trim($fields['last_name']),
            'birth_date' => ($fields['birth_date'] ?? '') ?: null,
            'contact_number' => trim($fields['contact_number']),
            'address' => trim($fields['address']),
        ];
    }

    private function membershipDetails(string $id): array
    {
        $capital = Membership::capital($id);

        return [
            'capital_account' => $capital['account'] ?? null,
            'capital_payments' => $capital['payments'] ?? [],
            'documents' => $this->documentRows($id),
        ];
    }

    private function documentRows(string $id): array
    {
        $rows = Sql::all('SELECT * FROM shareholder_documents WHERE shareholder_id = ? ORDER BY created_at DESC', [$id]);
        foreach ($rows as &$row) {
            $row['has_file'] = VerificationDocuments::hasFile($row['file_path']);
            $row['file_path'] = $row['has_file'] ? '/api/v1/documents/'.$row['id'].'/download' : '';
        }

        return $rows;
    }
}
