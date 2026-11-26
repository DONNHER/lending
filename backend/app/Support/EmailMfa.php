<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

final class EmailMfa
{
    private const EXPIRES_IN = 300;
    private const RESEND_DELAY = 30;
    private const MAX_ATTEMPTS = 5;

    public static function issue(string $userId, string $verifiedPasswordHash, bool $registration = false, string $purpose = 'sign_in', bool $remember = true): JsonResponse
    {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $id = (string) Str::uuid();
        $now = CarbonImmutable::now('UTC');
        $email = DB::transaction(function () use ($userId, $verifiedPasswordHash, $code, $id, $now, $purpose, $remember): string|JsonResponse {
            $user = DB::table('users')->where('id', $userId)->lockForUpdate()->first(['email', 'password_hash', 'account_status']);
            if ($user === null || $user->account_status !== 'active') {
                return Api::fail('This account is currently disabled.', 403);
            }
            if (!hash_equals($verifiedPasswordHash, $user->password_hash)) {
                return Api::fail('Account credentials changed. Sign in again.', 401);
            }

            $query = DB::table('email_mfa_challenges')->where('user_id', $userId)->where('purpose', $purpose);
            $challenge = $query->first();
            if ($challenge !== null && $challenge->used_at === null && CarbonImmutable::parse($challenge->created_at)->addSeconds(self::RESEND_DELAY) > $now) {
                return Api::fail('A code was requested recently. Wait 30 seconds before requesting another.', 429)
                    ->header('Retry-After', (string) self::RESEND_DELAY);
            }

            $query->delete();
            DB::table('email_mfa_challenges')->insert([
                'id' => $id,
                'user_id' => $userId,
                'purpose' => $purpose,
                'remembered' => (int) $remember,
                'code_digest' => self::digest($id, $code, $user),
                'expires_at' => $now->addSeconds(self::EXPIRES_IN)->toISOString(),
                'created_at' => $now->toISOString(),
            ]);

            return $user->email;
        }, 3);
        if ($email instanceof JsonResponse) {
            return $email;
        }

        try {
            $action = match ($purpose) {
                'require_mfa' => 'activation code for email MFA',
                'remove_mfa' => 'deactivation code for email MFA',
                default => 'sign-in code',
            };
            Mail::raw("Your Argivit Store {$action} is {$code}.\n\nThe code expires in 5 minutes. Keep it private. If you did not request it, you can ignore this email.",
                static fn (Message $message) => $message->to($email)->subject('Argivit Store '.$action));
        } catch (Throwable $error) {
            DB::table('email_mfa_challenges')->where('id', $id)->delete();
            logger()->warning('Sign-in code email could not be delivered.', ['error_type' => $error::class]);

            return Api::fail($registration
                ? 'Your account was created. Sign in again to request a verification code.'
                : 'We could not send a verification code. Try signing in again.', 503);
        }

        [$local, $domain] = explode('@', $email, 2);

        return Api::ok('Enter the code sent to your email.', [
            'mfa_required' => true,
            'challenge_id' => $id,
            'email_hint' => mb_substr($local, 0, 1).'***@'.$domain,
            'expires_in' => self::EXPIRES_IN,
        ], null, 202)->header('Cache-Control', 'no-store');
    }

    public static function verify(Request $request, string $id, string $code, string $purpose = 'sign_in', ?string $owner = null, ?Closure $onSuccess = null): JsonResponse
    {
        $userId = DB::table('email_mfa_challenges')->where('id', $id)->where('purpose', $purpose)->value('user_id');
        if ($userId === null || ($owner !== null && $userId !== $owner)) {
            return self::expired();
        }

        return DB::transaction(function () use ($request, $id, $code, $userId, $onSuccess): JsonResponse {
            $user = DB::table('users')->where('id', $userId)->lockForUpdate()->first(['id', 'name', 'email', 'password_hash', 'account_status']);
            $query = DB::table('email_mfa_challenges')->where('id', $id);
            $challenge = $query->first();
            if ($challenge === null || $challenge->used_at !== null || CarbonImmutable::parse($challenge->expires_at)->isPast()) {
                return self::expired();
            }
            if ($user === null || $user->account_status !== 'active') {
                return Api::fail('This account is currently disabled.', 403);
            }
            if ($challenge->failed_attempts >= self::MAX_ATTEMPTS) {
                return self::tooManyAttempts();
            }
            if (!hash_equals($challenge->code_digest, self::digest($id, $code, $user))) {
                $query->increment('failed_attempts');
                PasswordSignIn::audit($request, 'auth.email_code_failed', (array) $user, ['failures' => $challenge->failed_attempts + 1]);

                return $challenge->failed_attempts + 1 >= self::MAX_ATTEMPTS
                    ? self::tooManyAttempts()
                    : Api::fail('The verification code is incorrect.', 422);
            }

            $query->update(['used_at' => Api::now()]);
            if ($onSuccess !== null) {
                return $onSuccess();
            }
            $session = Sessions::begin(Sessions::userBy('id', $userId), remember: (bool) $challenge->remembered);
            PasswordSignIn::audit($request, 'auth.signed_in', $session['user'], ['method' => 'email_mfa']);

            return Api::ok('Signed in successfully.', $session)->header('Cache-Control', 'no-store');
        }, 3);
    }

    private static function digest(string $id, string $code, object $user): string
    {
        $key = config('argivit.jwt_secret') ?: config('app.key');
        if (!is_string($key) || strlen($key) < 32) {
            throw new RuntimeException('Set an application key or JWT_SECRET before enabling email MFA.');
        }

        return hash_hmac('sha256', implode("\0", ['email-mfa', $id, $code, $user->email, $user->password_hash]), $key);
    }

    private static function expired(): JsonResponse
    {
        return Api::fail('This verification code is no longer valid. Sign in to request a new code.', 422);
    }

    private static function tooManyAttempts(): JsonResponse
    {
        return Api::fail('Too many attempts for this code. Sign in to request a new code.', 429);
    }
}
