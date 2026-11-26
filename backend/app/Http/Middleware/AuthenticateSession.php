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
            $session = Sql::one('SELECT id, expires_at, revoked_at, remembered, last_active_at FROM user_sessions WHERE id = ? AND user_id = ?',
                [$claims['jti'], $claims['sub']]);
            if (!$session || $session['revoked_at']) {
                return Api::fail('Session has been revoked. Please sign in again.', 401);
            }
            if ($session['expires_at'] <= Api::now()) {
                return Api::fail('Session has expired.', 401);
            }
            $actor = Sessions::userBy('id', $claims['sub']);
            if ($actor && $actor['account_status'] === 'active') {
                $status = Sessions::describe(Sessions::activateLegacy($session), $actor['role']);
                if ($status['expires_at'] <= Api::now()) {
                    return Api::fail('Your session expired due to inactivity. Sign in again.', 401);
                }
                $request->attributes->set('argivit.session_status', $status);
            }
            $request->attributes->set('argivit.session', $claims['jti']);
            if (isset($claims['impersonated_by'])) {
                $impersonator = (array) $claims['impersonated_by'];
                $admin = Sessions::userBy('id', $impersonator['id'] ?? '');
                $originId = $claims['impersonation_origin'] ?? null;
                $origin = is_string($originId) && $admin && $admin['role'] === 'admin' && $admin['account_status'] === 'active'
                    ? Sessions::validOrigin($originId, $admin) : null;
                if ($origin === null) {
                    return Api::fail('This impersonation session has ended.', 401);
                }
                $status = $request->attributes->get('argivit.session_status');
                if ($status !== null) {
                    $request->attributes->set('argivit.session_status', Sessions::combineImpersonation($status, Sessions::describe($origin, $admin['role'])));
                }
                $request->attributes->set('argivit.impersonator', $impersonator);
                $request->attributes->set('argivit.impersonation_origin', $originId);
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
