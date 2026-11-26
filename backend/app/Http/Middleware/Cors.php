<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class Cors
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $origin = $request->headers->get('Origin');
        $allowedOrigins = [
            'http://localhost:14783',
            'http://127.0.0.1:14783',
        ];

        if ($origin && in_array($origin, $allowedOrigins, true)) {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Access-Control-Allow-Credentials', 'true');
            $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Range');
            $response->headers->set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Retry-After');
        }

        if ($request->getMethod() === 'OPTIONS') {
            return response('', 204)->withHeaders($response->headers->all());
        }

        return $response;
    }
}