<?php

namespace App\Http\Middleware;

use App\Support\Api;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RequireRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $actor = Api::actor($request);
        if (!$actor) {
            return Api::fail('Authentication required.', 401);
        }
        if (!in_array($actor['role'], $roles, true)) {
            return Api::fail('You do not have permission to access this module.', 403);
        }

        return $next($request);
    }
}
