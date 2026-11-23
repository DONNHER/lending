<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\LegacyPassword;
use App\Support\Sessions;
use App\Support\Sql;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class IdentityController extends Controller
{
    public function configuration(): JsonResponse
    {
        return Api::ok('Authentication configuration retrieved.', [
            'auth_url' => config('argivit.auth_url'),
            'data_api_url' => config('argivit.data_api_url'),
            'demo_accounts' => app()->environment('local', 'testing') && !config('argivit.auth_url')
                && (DB::connection()->getDriverName() === 'sqlite' || Sessions::allowsLocalDockerAuth()),
        ])->header('Cache-Control', 'no-store');
    }

    public function login(Request $request): JsonResponse
    {
        if (config('argivit.auth_url')) {
            return Api::fail('Sign in through external authentication.', 403);
        }
        $input = $request->validate(['email' => 'required|email', 'password' => 'required|string']);
        $user = Sql::one('SELECT id, password_hash, account_status FROM users WHERE lower(email) = lower(?)', [$input['email']]);
        if (!$user || !LegacyPassword::verify($input['password'], $user['password_hash'])) {
            return Api::fail('Invalid email or password.', 401);
        }
        if ($user['account_status'] !== 'active') {
            return Api::fail('This account is currently disabled.', 403);
        }
        if (LegacyPassword::isLegacy($user['password_hash']) && strlen($input['password']) <= 72 && !str_contains($input['password'], "\0")) {
            Sql::run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?',
                [password_hash($input['password'], PASSWORD_DEFAULT), $user['id'], $user['password_hash']]);
        }

        return Api::ok('Signed in successfully.', Sessions::begin(Sessions::userBy('id', $user['id'])));
    }

    public function register(Request $request): JsonResponse
    {
        if (config('argivit.auth_url')) {
            return Api::fail('Create your account through external authentication.', 403);
        }
        $input = $request->validate([
            'email' => 'required|email', 'password' => 'required|string|min:6|max:72',
            'first_name' => 'required|string', 'last_name' => 'required|string',
            'contact_number' => 'sometimes|nullable|string', 'address' => 'sometimes|nullable|string',
        ]);
        if (strlen($input['password']) > 72 || str_contains($input['password'], "\0")) {
            throw ValidationException::withMessages(['password' => ['Enter a password of at most 72 bytes without null characters.']]);
        }

        return DB::transaction(function () use ($input): JsonResponse {
            if (Sessions::allowsLocalDockerAuth()) {
                Sql::one('SELECT pg_advisory_xact_lock(hashtext(?))', ['argivit-auth:'.strtolower($input['email'])]);
            }
            if (Sessions::userBy('email', $input['email'])) {
                return Api::fail('The submitted data is invalid.', 422, ['email' => ['An account with this email already exists.']]);
            }
            $user = $this->createBorrower($input, 'local-'.Str::uuid(), password_hash($input['password'], PASSWORD_DEFAULT));

            return Api::ok('Shareholder account created. Complete verification and initial share capital to unlock loans.',
                Sessions::begin($user), null, 201);
        });
    }

    public function synchronize(Request $request): JsonResponse
    {
        $verified = (bool) config('argivit.jwks_url');
        $claims = [];
        if ($verified) {
            $token = $request->bearerToken() ?? $request->input('access_token');
            $claims = is_string($token) ? Sessions::external($token) : null;
            if (!$claims) {
                return Api::fail('Invalid or expired external authentication token.', 401);
            }
            $subject = $claims['sub'];
            $email = $claims['email'] ?? null;
            $name = $claims['name'] ?? null;
        } elseif (app()->environment('local', 'testing') && config('argivit.allow_demo_auth')
            && DB::connection()->getDriverName() === 'sqlite') {
            $demo = $request->validate(['auth_user_id' => 'required|string|min:3', 'email' => 'required|email', 'name' => 'required|string']);
            $subject = $demo['auth_user_id'];
            $email = $demo['email'];
            $name = $demo['name'];
        } else {
            return Api::fail('External authentication is not configured.', 503);
        }

        if (!is_string($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return Api::fail('Synchronization requires a valid email claim.', 422);
        }

        $profile = $request->validate([
            'first_name' => 'sometimes|nullable|string|max:100', 'last_name' => 'sometimes|nullable|string|max:100',
            'contact_number' => 'sometimes|nullable|string|max:60', 'address' => 'sometimes|nullable|string|max:500',
        ]);
        $emailVerified = ($claims['email_verified'] ?? $claims['emailVerified'] ?? false) === true;
        if (config('argivit.auth_url') && !$emailVerified) {
            return Api::fail('Verify your email before signing in.', 403);
        }

        return DB::transaction(function () use ($subject, $email, $name, $verified, $emailVerified, $profile): JsonResponse {
            if (DB::connection()->getDriverName() === 'pgsql') {
                Sql::one('SELECT pg_advisory_xact_lock(hashtext(?))', ['argivit-auth:'.strtolower($email)]);
            }
            $user = Sessions::userBy('auth_user_id', $subject);
            if (!$verified && $user && ($user['role'] !== 'shareholder' || strcasecmp($user['email'], $email) !== 0)) {
                return Api::fail('Demo synchronization is available for shareholder identities only.', 403);
            }
            if (!$user) {
                $emailAccount = Sessions::userBy('email', $email);
                if ($emailAccount) {
                    if (config('argivit.auth_url') || !$verified || !$emailVerified || $emailAccount['role'] !== 'shareholder') {
                        return Api::fail('This email is already linked to an account.', 409);
                    }
                    Sql::run('UPDATE users SET auth_user_id = ? WHERE id = ?', [$subject, $emailAccount['id']]);
                    $user = array_replace($emailAccount, ['auth_user_id' => $subject]);
                } else {
                    $displayName = is_string($name) && trim($name) !== '' ? trim($name) : Str::before($email, '@');
                    [$firstName, $lastName] = array_pad(preg_split('/\s+/', $displayName, 2), 2, 'Shareholder');
                    $user = $this->createBorrower([
                        'first_name' => ($profile['first_name'] ?? '') ?: $firstName,
                        'last_name' => ($profile['last_name'] ?? '') ?: $lastName,
                        'email' => $email,
                        'contact_number' => $profile['contact_number'] ?? null,
                        'address' => $profile['address'] ?? null,
                    ],
                        $subject, password_hash(Str::random(48), PASSWORD_DEFAULT), 'auth.synchronized');
                }
            }
            if ($user['account_status'] !== 'active') {
                return Api::fail('This account is currently disabled.', 403);
            }

            return Api::ok('Identity synchronized with cooperative ledger.', Sessions::begin($user));
        });
    }

    private function createBorrower(array $input, string $subject, string $passwordHash, string $action = 'shareholder.registered'): array
    {
        $user = ['id' => Api::id('usr'), 'auth_user_id' => $subject,
            'name' => $input['first_name'].' '.$input['last_name'], 'email' => $input['email'],
            'role' => 'shareholder', 'account_status' => 'active', 'created_at' => Api::now()];
        $shareholderId = Api::id('sh');
        $membershipNumber = 'ARG-SH-'.strtoupper(bin2hex(random_bytes(4)));
        $settings = Sql::one('SELECT required_initial_capital FROM share_capital_settings LIMIT 1');
        DB::table('users')->insert($user + ['password_hash' => $passwordHash]);
        DB::table('role_user')->insert(['user_id' => $user['id'], 'role_id' => 'role-shareholder']);
        DB::table('shareholder_profiles')->insert([
            'id' => $shareholderId, 'user_id' => $user['id'], 'membership_number' => $membershipNumber,
            'first_name' => $input['first_name'], 'last_name' => $input['last_name'],
            'contact_number' => ($input['contact_number'] ?? '') ?: null, 'address' => ($input['address'] ?? '') ?: null,
            'verification_status' => 'incomplete', 'created_at' => $user['created_at'],
        ]);
        DB::table('share_capital_accounts')->insert([
            'id' => Api::id('cap-acc'), 'shareholder_id' => $shareholderId,
            'required_amount' => $settings['required_initial_capital'], 'status' => 'unpaid', 'created_at' => $user['created_at'],
        ]);
        if ($action === 'auth.synchronized') {
            Api::audit($user, $action, 'user', $user['id'], ['auth_user_id' => $subject]);
        } else {
            Api::audit($user, $action, 'shareholder_profile', $shareholderId, ['membership_number' => $membershipNumber]);
        }

        return $user;
    }

    public function me(Request $request): JsonResponse
    {
        $user = Api::actor($request);

        return Api::ok('Session active.', ['user' => $user, 'permissions' => Sessions::permissions($user['role']),
            'impersonated_by' => $request->attributes->get('argivit.impersonator')]);
    }

    public function logout(Request $request): JsonResponse
    {
        Sessions::revoke($request->attributes->get('argivit.session'));

        return Api::ok('Logged out successfully.');
    }

    public function users(): JsonResponse
    {
        return Api::ok('Users retrieved successfully.', Sql::all(
            'SELECT id, auth_user_id, name, email, role, account_status, created_at FROM users ORDER BY created_at DESC',
        ));
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $status = $request->validate(['account_status' => 'required|in:active,disabled'])['account_status'];
        if ($id === Api::actor($request)['id'] && $status === 'disabled') {
            return Api::fail('You cannot disable your own administrator account.', 400);
        }

        return DB::transaction(function () use ($request, $id, $status): JsonResponse {
            if (!Sessions::userBy('id', $id)) {
                return Api::fail('User not found.', 404);
            }
            Sql::run('UPDATE users SET account_status = ? WHERE id = ?', [$status, $id]);
            if ($status === 'disabled') {
                Sql::run('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Api::now(), $id]);
            }
            Api::audit(Api::actor($request), 'user.status_updated', 'user', $id, ['account_status' => $status]);

            return Api::ok('User status updated.', ['id' => $id, 'account_status' => $status]);
        });
    }

    public function updateRole(Request $request, string $id): JsonResponse
    {
        $role = $request->validate(['role' => 'required|in:admin,manager,cashier,shareholder'])['role'];

        return DB::transaction(function () use ($request, $id, $role): JsonResponse {
            if (!Sessions::userBy('id', $id)) {
                return Api::fail('User not found.', 404);
            }
            Sql::run('UPDATE users SET role = ? WHERE id = ?', [$role, $id]);
            Sql::run('DELETE FROM role_user WHERE user_id = ?', [$id]);
            Sql::run('INSERT INTO role_user (user_id, role_id) VALUES (?, ?)', [$id, 'role-'.$role]);
            Api::audit(Api::actor($request), 'user.role_updated', 'user', $id, ['role' => $role]);

            return Api::ok('User role updated.', ['id' => $id, 'role' => $role]);
        });
    }

    public function startImpersonation(Request $request): JsonResponse
    {
        $id = $request->validate(['target_user_id' => 'required|string'])['target_user_id'];
        $user = Sessions::userBy('id', $id);
        if (!$user) {
            return Api::fail('Target user not found.', 404);
        }
        if ($user['account_status'] !== 'active' || $request->attributes->has('argivit.impersonator')) {
            return Api::fail('This account cannot be impersonated from this session.', 400);
        }
        $admin = array_intersect_key(Api::actor($request), array_flip(['id', 'name', 'email']));

        return DB::transaction(function () use ($admin, $user): JsonResponse {
            $data = Sessions::begin($user, $admin);
            Api::audit($admin, 'admin.impersonation_started', 'user', $user['id'], ['target_email' => $user['email']]);

            return Api::ok("Now viewing system as {$user['name']} ({$user['role']}).", $data);
        });
    }

    public function endImpersonation(Request $request): JsonResponse
    {
        $impersonator = $request->attributes->get('argivit.impersonator');
        if (!$impersonator) {
            return Api::fail('No active impersonation session.', 400);
        }
        $admin = Sessions::userBy('id', $impersonator['id']);
        if (!$admin) {
            return Api::fail('Original admin account not found.', 404);
        }

        return DB::transaction(function () use ($request, $admin): JsonResponse {
            Sessions::revoke($request->attributes->get('argivit.session'));
            $data = Sessions::begin($admin);
            Api::audit($admin, 'admin.impersonation_ended', 'user', Api::actor($request)['id']);

            return Api::ok('Returned to Administrator session.', $data);
        });
    }

    public function auditLog(Request $request): JsonResponse
    {
        $text = is_string($request->query('q')) ? strtolower(trim($request->query('q'))) : '';
        $action = is_string($request->query('action')) ? strtolower(trim($request->query('action'))) : '';
        $rows = Sql::all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
        $entries = [];
        foreach ($rows as $row) {
            if (($action !== '' && !str_contains(strtolower($row['action']), $action))
                || ($text !== '' && !str_contains(strtolower(implode(' ', [$row['actor_name'], $row['action'], $row['entity_type'], $row['entity_id']])), $text))) {
                continue;
            }
            $row['metadata'] = json_decode($row['metadata_json']) ?? (object) [];
            unset($row['metadata_json']);
            $entries[] = $row;
        }

        return Api::ok('Audit logs retrieved.', $entries);
    }

    public function settings(): JsonResponse
    {
        return Api::ok('System settings retrieved.', ['share_capital' => Sql::one('SELECT * FROM share_capital_settings LIMIT 1'),
            'loan' => Sql::one('SELECT * FROM loan_settings LIMIT 1')]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $input = $request->validate(['required_initial_capital' => 'required|numeric|gt:0',
            'capital_multiplier' => 'required|numeric|between:1,20', 'interest_rate' => 'required|numeric|between:0,0.5',
            'waiting_period_days' => 'required|integer|between:1,60']);

        return DB::transaction(function () use ($request, $input): JsonResponse {
            Sql::run('UPDATE share_capital_settings SET required_initial_capital = ?', [$input['required_initial_capital']]);
            Sql::run('UPDATE loan_settings SET capital_multiplier = ?, interest_rate = ?, waiting_period_days = ?',
                [$input['capital_multiplier'], $input['interest_rate'], $input['waiting_period_days']]);
            Api::audit(Api::actor($request), 'settings.updated', 'system_settings', 'global', $input);

            return Api::ok('System policy settings updated.', $input);
        });
    }
}
