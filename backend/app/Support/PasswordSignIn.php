<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class PasswordSignIn
{
    private const MAX_FAILURES = 5;
    private const WINDOW_SECONDS = 900;
    private const DUMMY_HASH = '$2y$12$FAGlobMndXie1pI45wmq4.u239TtnXlJT4zAunHcxqjfHMw/FN9Dm';

    public static function verify(Request $request, string $email, string $password): array|JsonResponse
    {
        $key = config('argivit.jwt_secret') ?: config('app.key');
        if (!is_string($key) || strlen($key) < 32) {
            throw new RuntimeException('Set an application key or JWT_SECRET before using the API.');
        }
        $digest = hash_hmac('sha256', 'sign-in:'.mb_strtolower($email), $key);
        $record = DB::table('sign_in_attempts')->where('account_digest', $digest)->first();
        $now = now()->getTimestamp();
        if ($record && $record->failures >= self::MAX_FAILURES && $record->expires_at > $now) {
            return self::locked($record->expires_at - $now);
        }
        $user = Sql::one('SELECT id, name, password_hash, account_status FROM users WHERE lower(email) = lower(?)', [$email]);
        $valid = LegacyPassword::verify($password, $user['password_hash'] ?? self::DUMMY_HASH);

        return DB::transaction(function () use ($request, $user, $valid, $digest): array|JsonResponse {
            $now = now()->getTimestamp();
            $attempts = DB::table('sign_in_attempts');
            // Take the row lock even when it already exists, so cleanup and sign-in cannot remove it before the read.
            $attempts->upsert(['account_digest' => $digest, 'expires_at' => $now + self::WINDOW_SECONDS], ['account_digest'], ['account_digest']);
            $accountAttempts = $attempts->where('account_digest', $digest);
            $record = $accountAttempts->first();
            $failures = $record->expires_at > $now ? (int) $record->failures : 0;
            if ($failures >= self::MAX_FAILURES) {
                return self::locked($record->expires_at - $now);
            }

            if (!$user || !$valid) {
                $failures++;
                $expires = in_array($failures, [1, self::MAX_FAILURES], true) ? $now + self::WINDOW_SECONDS : $record->expires_at;
                $accountAttempts->update(['failures' => $failures, 'expires_at' => $expires]);
                self::audit($request, 'auth.password_failed', $user, ['failures' => $failures]);
                if ($failures === 3) {
                    self::audit($request, 'auth.suspicious_activity', $user, ['failures' => $failures]);
                }

                return $failures >= self::MAX_FAILURES
                    ? self::locked(self::WINDOW_SECONDS)
                    : Api::fail('Invalid email or password.', 401);
            }

            $accountAttempts->delete();

            return $user;
        }, 3);
    }

    public static function audit(Request $request, string $action, ?array $actor, array $metadata = []): void
    {
        $actor ??= ['id' => 'anonymous', 'name' => 'Anonymous'];
        Api::audit($actor, $action, 'user', $actor['id'], $metadata + [
            'ip' => $request->ip(),
            'user_agent' => mb_substr(mb_convert_encoding((string) $request->userAgent(), 'UTF-8', 'UTF-8'), 0, 255),
        ]);
    }

    private static function locked(int $seconds): JsonResponse
    {
        return Api::fail('Too many sign-in attempts. Try again in a few minutes.', 429)->header('Retry-After', (string) $seconds);
    }
}
