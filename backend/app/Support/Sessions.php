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

    public static function begin(array $user, ?array $impersonator = null): array
    {
        $now = CarbonImmutable::now('UTC');
        $expires = $now->addDays(7);
        $id = 'sess-'.Str::uuid();
        $token = JWT::encode([
            'jti' => $id, 'sub' => $user['id'], 'role' => $user['role'],
            'impersonated_by' => $impersonator, 'exp' => $expires->getTimestamp(),
        ], self::key(), 'HS256');
        Sql::run('INSERT INTO user_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
            [$id, $user['id'], $expires->format('Y-m-d\TH:i:s.v\Z'), $now->format('Y-m-d\TH:i:s.v\Z')]);

        return ['token' => $token, 'user' => $user, 'permissions' => self::permissions($user['role']), 'impersonated_by' => $impersonator];
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
