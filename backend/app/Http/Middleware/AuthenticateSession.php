<?php

namespace App\Http\Middleware;

use App\Support\Api;
use App\Support\Sessions;
use App\Support\Sql;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AuthenticateSession
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        if (!$token) {
            return Api::fail('Authentication required.', 401);
        }

        $claims = Sessions::internal($token);
        if ($claims) {
            $session = Sql::one('SELECT expires_at, revoked_at FROM user_sessions WHERE id = ? AND user_id = ?',
                [$claims['jti'], $claims['sub']]);
            if (!$session || $session['revoked_at']) {
                return Api::fail('Session has been revoked. Please sign in again.', 401);
            }
            if ($session['expires_at'] <= Api::now()) {
                return Api::fail('Session has expired.', 401);
            }
            $actor = Sessions::userBy('id', $claims['sub']);
            $request->attributes->set('argivit.session', $claims['jti']);
            if (isset($claims['impersonated_by'])) {
                $impersonator = (array) $claims['impersonated_by'];
                $admin = Sessions::userBy('id', $impersonator['id'] ?? '');
                if (!$admin || $admin['role'] !== 'admin' || $admin['account_status'] !== 'active') {
                    return Api::fail('This impersonation session has ended.', 401);
                }
                $request->attributes->set('argivit.impersonator', $impersonator);
            }
        } else {
            $identity = Sessions::external($token);
            if (!$identity) {
                return Api::fail('Invalid or expired authentication token.', 401);
            }
            $actor = Sessions::userBy('auth_user_id', $identity['sub']);
        }

        if (!$actor) {
            return Api::fail('Authenticated user record not found.', 401);
        }
        if ($actor['account_status'] !== 'active') {
            return Api::fail('Your account has been disabled by an administrator.', 403);
        }
        $request->attributes->set('argivit.actor', $actor);

        return $next($request);
    }
}
