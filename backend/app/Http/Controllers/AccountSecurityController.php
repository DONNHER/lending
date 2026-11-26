<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Sessions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Throwable;

final class AccountSecurityController extends Controller
{
    public static function recoveryUrl(): ?string
    {
        if (config('argivit.auth_url') || config('argivit.jwks_url')) {
            return null;
        }
        $url = rtrim((string) config('argivit.web_url'), '/');
        if ($url === '' && app()->environment('local', 'testing')) {
            return 'http://localhost:5173';
        }
        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])) {
            return null;
        }
        $scheme = $parts['scheme'] ?? '';

        return $scheme === 'https' || ($scheme === 'http' && app()->environment('local', 'testing')) ? $url : null;
    }

    public function requestReset(Request $request): JsonResponse
    {
        $url = self::recoveryUrl();
        if ($url === null) {
            return Api::fail('Password recovery is unavailable on this deployment.', 503);
        }
        $input = $request->validate(['email' => 'required|email|max:254']);
        app()->terminating(function () use ($input, $url): void {
            try {
                $user = Sessions::userBy('email', $input['email']);
                if ($user !== null && $user['account_status'] === 'active') {
                    $this->sendLink($user['id'], $url);
                }
            } catch (Throwable $error) {
                logger()->warning('Password recovery request failed.', ['error_type' => $error::class]);
            }
        });

        return Api::ok('If the account can receive a reset link, check your email.', null, null, 202)
            ->header('Cache-Control', 'no-store');
    }

    public function adminReset(Request $request, string $id): JsonResponse
    {
        $url = self::recoveryUrl();
        if ($url === null) {
            return Api::fail('Password recovery is unavailable on this deployment.', 503);
        }
        $user = Sessions::userBy('id', $id);
        if ($user === null) {
            return Api::fail('User not found.', 404);
        }
        if ($user['account_status'] !== 'active') {
            return Api::fail('Activate the account before sending a reset link.', 409);
        }
        $status = $this->sendLink($id, $url);
        if ($status === 'cooldown') {
            return Api::fail('A reset link was requested recently. Try again in one minute.', 429)
                ->header('Retry-After', '60');
        }
        if ($status !== 'sent') {
            return Api::fail('The reset email could not be sent. Check the mail service and retry.', 503);
        }
        Api::audit(Api::actor($request), 'auth.admin_password_reset_requested', 'user', $id);

        return Api::ok('Password reset link sent to the account email.', null, null, 202)
            ->header('Cache-Control', 'no-store');
    }

    public function reset(Request $request): JsonResponse
    {
        if (config('argivit.auth_url') || config('argivit.jwks_url')) {
            return Api::fail('Reset your password with the external sign-in provider.', 409);
        }
        $input = $request->validate([
            'token' => ['required', 'string', 'regex:/\A[0-9a-f]{64}\z/'],
            'password' => ['required', 'string', 'max:72', 'confirmed', Password::min(8)->mixedCase()->numbers()->symbols()],
        ]);
        if (strlen($input['password']) > 72 || str_contains($input['password'], "\0")) {
            throw ValidationException::withMessages(['password' => ['Enter a password of at most 72 bytes without null characters.']]);
        }

        $digest = hash('sha256', $input['token']);
        $challenge = DB::table('password_reset_requests')->where('token_digest', $digest)->first();
        if ($challenge === null || $challenge->expires_at <= now()->getTimestamp()) {
            return $this->expired();
        }
        $newHash = password_hash($input['password'], PASSWORD_DEFAULT);

        return DB::transaction(function () use ($challenge, $digest, $newHash): JsonResponse {
            $user = DB::table('users')->where('id', $challenge->user_id)->lockForUpdate()->first(['id', 'name', 'account_status']);
            if ($user === null || $user->account_status !== 'active'
                || DB::table('password_reset_requests')->where('token_digest', $digest)
                    ->where('expires_at', '>', now()->getTimestamp())->delete() !== 1) {
                return $this->expired();
            }
            DB::table('users')->where('id', $user->id)->update(['password_hash' => $newHash]);
            Sessions::revokeAll($user->id);
            Api::audit((array) $user, 'auth.password_reset_completed', 'user', $user->id);

            return Api::ok('Password changed. Sign in with your new password.')->header('Cache-Control', 'no-store');
        }, 3);
    }

    public function forceLogout(Request $request, string $id): JsonResponse
    {
        if ($id === Api::actor($request)['id'] && $request->attributes->has('argivit.impersonator')) {
            return Api::fail('End impersonation before signing this account out.', 409);
        }

        return DB::transaction(function () use ($request, $id): JsonResponse {
            $user = DB::table('users')->where('id', $id)->lockForUpdate()->first(['id']);
            if ($user === null) {
                return Api::fail('User not found.', 404);
            }
            $count = Sessions::revokeAll($id);
            Api::audit(Api::actor($request), 'auth.admin_signed_out_devices', 'user', $id, ['sessions_revoked' => $count]);

            return Api::ok('All Argivit sessions for this account were signed out.', ['sessions_revoked' => $count]);
        }, 3);
    }

    public function activity(Request $request): JsonResponse
    {
        $id = $request->attributes->get('argivit.session');
        if ($id === null) {
            return Api::ok('Activity recorded.', null)->header('Cache-Control', 'no-store');
        }
        $session = Sessions::refreshActivity($id, Api::actor($request)['role']);
        $origin = $request->attributes->get('argivit.impersonation_origin');
        if ($session !== null && $origin !== null) {
            $admin = Sessions::refreshActivity($origin, 'admin');
            $session = $admin === null ? null : Sessions::combineImpersonation($session, $admin);
        }

        return $session === null
            ? Api::fail('Your session has expired. Sign in again.', 401)
            : Api::ok('Activity recorded.', $session)->header('Cache-Control', 'no-store');
    }

    public function sessions(Request $request): JsonResponse
    {
        return Api::ok('Devices retrieved.', Sessions::devices(Api::actor($request), $request->attributes->get('argivit.session')))
            ->header('Cache-Control', 'no-store');
    }

    public function userSessions(Request $request, string $id): JsonResponse
    {
        $user = Sessions::userBy('id', $id);
        if ($user === null) {
            return Api::fail('User not found.', 404);
        }

        return Api::ok('Devices retrieved.', Sessions::devices($user, $request->attributes->get('argivit.session')))
            ->header('Cache-Control', 'no-store');
    }

    public function revokeSession(Request $request, string $session): JsonResponse
    {
        $actor = Api::actor($request);
        $count = DB::table('user_sessions')->where('id', $session)->where('user_id', $actor['id'])
            ->whereNull('revoked_at')->update(['revoked_at' => Api::now()]);
        if ($count > 0) {
            Api::audit($actor, 'auth.device_signed_out', 'user', $actor['id'], ['session_id' => $session]);
        }

        return Api::ok('Device signed out.')->header('Cache-Control', 'no-store');
    }


    private function sendLink(string $id, string $url): string
    {
        $token = bin2hex(random_bytes(32));
        $digest = hash('sha256', $token);
        $recipient = DB::transaction(function () use ($id, $digest): ?string {
            $user = DB::table('users')->where('id', $id)->lockForUpdate()->first(['email', 'account_status']);
            if ($user === null || $user->account_status !== 'active') {
                return null;
            }
            $now = now()->getTimestamp();
            $request = DB::table('password_reset_requests')->where('user_id', $id)->first();
            if ($request !== null && $request->requested_at + 60 > $now) {
                return null;
            }
            DB::table('password_reset_requests')->upsert([
                'user_id' => $id, 'token_digest' => $digest, 'requested_at' => $now, 'expires_at' => $now + 1800,
            ], ['user_id'], ['token_digest', 'requested_at', 'expires_at']);

            return $user->email;
        }, 3);
        if ($recipient === null) {
            return 'cooldown';
        }

        try {
            $link = $url.'/#reset-password='.$token;
            Mail::raw("Open this link to reset your Argivit Store password:\n\n{$link}\n\nThe link expires in 30 minutes and works once. If you did not request it, you can ignore this email.",
                static fn (Message $message) => $message->to($recipient)->subject('Reset your Argivit Store password'));
        } catch (Throwable $error) {
            DB::table('password_reset_requests')->where('token_digest', $digest)->delete();
            logger()->warning('Password reset email could not be delivered.', ['error_type' => $error::class]);

            return 'failed';
        }

        return 'sent';
    }

    private function expired(): JsonResponse
    {
        return Api::fail('This reset link has expired or has been used. Request a new link.', 422);
    }
}
