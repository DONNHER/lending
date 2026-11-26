<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;
use UnexpectedValueException;

final class Sessions
{
    public static function allowsLocalDockerAuth(): bool
    {
        return app()->environment('local', 'testing') && DB::connection()->getName() === 'pgsql_docker';
    }

    private const USER_FIELDS = 'id, auth_user_id, name, email, role, account_status, created_at';

    public static function userBy(string $field, string $value): ?array
    {
        return match ($field) {
            'id' => Sql::one('SELECT '.self::USER_FIELDS.' FROM users WHERE id = ?', [$value]),
            'auth_user_id' => Sql::one('SELECT '.self::USER_FIELDS.' FROM users WHERE auth_user_id = ?', [$value]),
            'email' => Sql::one('SELECT '.self::USER_FIELDS.' FROM users WHERE lower(email) = lower(?)', [$value]),
        };
    }

    public static function permissions(string $role): array
    {
        return array_column(Sql::all(
            'SELECT p.name FROM permissions p JOIN permission_role pr ON p.id = pr.permission_id JOIN roles r ON pr.role_id = r.id WHERE r.name = ? ORDER BY p.name',
            [$role],
        ), 'name');
    }

    public static function begin(array $user, ?array $impersonator = null, bool $remember = true, ?string $origin = null): array
    {
        $now = CarbonImmutable::now('UTC');
        $expires = $remember ? $now->addDays(7) : $now->addHours(12);
        $id = 'sess-'.Str::uuid();
        $record = [
            'id' => $id,
            'user_id' => $user['id'],
            'expires_at' => $expires->format('Y-m-d\TH:i:s.v\Z'),
            'created_at' => $now->format('Y-m-d\TH:i:s.v\Z'),
            'last_active_at' => $now->format('Y-m-d\TH:i:s.v\Z'),
            'remembered' => (int) $remember,
            'device' => mb_substr(mb_convert_encoding((string) request()->userAgent(), 'UTF-8', 'UTF-8'), 0, 255),
        ];
        DB::table('user_sessions')->insert($record);

        return self::payload($user, $record, $impersonator, $origin);
    }

    private static function payload(array $user, array $record, ?array $impersonator = null, ?string $origin = null): array
    {
        $token = JWT::encode([
            'jti' => $record['id'], 'sub' => $user['id'], 'role' => $user['role'],
            'impersonated_by' => $impersonator, 'impersonation_origin' => $origin,
            'exp' => CarbonImmutable::parse($record['expires_at'])->getTimestamp(),
        ], self::key(), 'HS256');

        return ['token' => $token, 'user' => $user, 'permissions' => self::permissions($user['role']),
            'impersonated_by' => $impersonator, 'session' => self::describe($record, $user['role'])];
    }

    public static function validOrigin(string $id, array $admin): ?array
    {
        $record = DB::table('user_sessions')->where('id', $id)->where('user_id', $admin['id'])->whereNull('revoked_at')->first();
        if ($record === null || self::describe((array) $record, $admin['role'])['expires_at'] <= Api::now()) {
            return null;
        }

        return (array) $record;
    }

    public static function resume(array $user, string $id): ?array
    {
        $record = self::validOrigin($id, $user);

        return $record === null ? null : self::payload($user, $record);
    }

    public static function combineImpersonation(array $target, array $origin): array
    {
        $target['expires_at'] = min($target['expires_at'], $origin['expires_at']);
        $target['idle_timeout'] = $target['idle_timeout'] || $origin['idle_timeout'];

        return $target;
    }

    public static function beginWithPassword(string $userId, string $verifiedHash, bool $remember): ?array
    {
        return DB::transaction(function () use ($userId, $verifiedHash, $remember): ?array {
            $user = DB::table('users')->where('id', $userId)->lockForUpdate()->first(['password_hash', 'account_status']);
            if ($user === null || $user->account_status !== 'active' || !hash_equals($verifiedHash, $user->password_hash)) {
                return null;
            }

            return self::begin(self::userBy('id', $userId), remember: $remember);
        }, 3);
    }

    public static function describe(array $session, string $role): array
    {
        $idle = $role !== 'cashier';
        $deadline = $session['expires_at'];
        if ($idle && $session['last_active_at'] !== null) {
            $idleDeadline = CarbonImmutable::parse($session['last_active_at'])->addMinutes(30)->format('Y-m-d\TH:i:s.v\Z');
            $deadline = min($deadline, $idleDeadline);
        }

        return ['id' => $session['id'], 'expires_at' => $deadline, 'remembered' => (bool) $session['remembered'], 'idle_timeout' => $idle];
    }

    public static function activateLegacy(array $session): array
    {
        if ($session['last_active_at'] !== null) {
            return $session;
        }
        DB::table('user_sessions')->where('id', $session['id'])->whereNull('last_active_at')
            ->update(['last_active_at' => Api::now()]);
        $session['last_active_at'] = DB::table('user_sessions')->where('id', $session['id'])->value('last_active_at');

        return $session;
    }

    public static function refreshActivity(string $id, string $role): ?array
    {
        return DB::transaction(function () use ($id, $role): ?array {
            $query = DB::table('user_sessions')->where('id', $id)->whereNull('revoked_at');
            $record = $query->lockForUpdate()->first();
            $now = Api::now();
            if ($record === null || self::describe((array) $record, $role)['expires_at'] <= $now) {
                return null;
            }
            $query->update(['last_active_at' => $now]);
            $record->last_active_at = $now;

            return self::describe((array) $record, $role);
        }, 3);
    }

    public static function devices(array $user, ?string $current): array
    {
        $now = Api::now();

        return DB::table('user_sessions')->where('user_id', $user['id'])->orderByDesc('created_at')->limit(50)
            ->get()->map(static function (object $record) use ($user, $current, $now): array {
                $session = self::describe((array) $record, $user['role']);

                return $session + [
                    'device' => $record->device, 'created_at' => $record->created_at, 'last_active_at' => $record->last_active_at,
                    'current' => $current === $record->id, 'active' => $record->revoked_at === null && $session['expires_at'] > $now,
                ];
            })->all();
    }

    public static function revokeAll(string $userId): int
    {
        DB::table('email_mfa_challenges')->where('user_id', $userId)->where('purpose', 'sign_in')->delete();

        return DB::table('user_sessions')->where('user_id', $userId)->whereNull('revoked_at')->where('expires_at', '>', Api::now())
            ->update(['revoked_at' => Api::now()]);
    }

    public static function revoke(?string $id): void
    {
        if ($id !== null) {
            Sql::run('UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [Api::now(), $id]);
        }
    }

    public static function internal(string $token): ?array
    {
        try {
            $claims = get_object_vars(JWT::decode($token, new Key(self::key(), 'HS256')));

            return is_string($claims['sub'] ?? null) && is_string($claims['jti'] ?? null) && is_int($claims['exp'] ?? null)
                ? $claims : null;
        } catch (UnexpectedValueException | \DomainException) {
            return null;
        }
    }

    public static function external(string $token): ?array
    {
        $url = config('argivit.jwks_url');
        if (!is_string($url) || $url === '') {
            return null;
        }

        try {
            $encoded = explode('.', $token)[0];
            $header = json_decode(base64_decode(strtr($encoded, '-_', '+/'), true), true, flags: JSON_THROW_ON_ERROR);
            $algorithm = $header['alg'] ?? '';
            $allowedAlgorithms = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
            if (!in_array($algorithm, $allowedAlgorithms, true)) {
                return null;
            }

            $cacheKey = 'auth-jwks-'.hash('sha256', $url);
            $keys = Cache::remember($cacheKey, 300, fn () => self::loadKeys($url));
            $key = self::selectKey($keys, $header['kid'] ?? null, $algorithm);
            if (!$key && Cache::add($cacheKey.'-refresh', true, 10)) {
                $keys = self::loadKeys($url);
                Cache::put($cacheKey, $keys, 300);
                $key = self::selectKey($keys, $header['kid'] ?? null, $algorithm);
            }
            if (!$key) {
                return null;
            }

            $claims = get_object_vars(JWT::decode($token, $key));
            $issuer = config('argivit.jwt_issuer');
            $audience = config('argivit.jwt_audience');
            if (!is_string($claims['sub'] ?? null) || $claims['sub'] === '' || !is_int($claims['exp'] ?? null)
                || ($issuer && ($claims['iss'] ?? null) !== $issuer)
                || ($audience && !in_array($audience, (array) ($claims['aud'] ?? []), true))) {
                return null;
            }

            return $claims;
        } catch (Throwable) {
            return null;
        }
    }

    private static function key(): string
    {
        $key = config('argivit.jwt_secret') ?: config('app.key');
        if (!is_string($key) || strlen($key) < 32) {
            throw new RuntimeException('Set an application key or JWT_SECRET before using the API.');
        }

        return $key;
    }

    private static function loadKeys(string $url): array
    {
        return Http::acceptJson()->timeout(4)->get($url)->throw()->json('keys') ?? [];
    }

    private static function selectKey(array $keys, ?string $kid, string $algorithm): ?Key
    {
        foreach ($keys as $key) {
            if (($kid === null || ($key['kid'] ?? null) === $kid)
                && ($key['alg'] ?? $algorithm) === $algorithm && ($key['use'] ?? 'sig') === 'sig') {
                return JWK::parseKey($key, $algorithm);
            }
        }

        return null;
    }
}
