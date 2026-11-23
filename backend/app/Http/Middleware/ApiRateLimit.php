<?php

namespace App\Http\Middleware;

use App\Support\Api;
use App\Support\Sql;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ApiRateLimit
{
    private const LIMITS = ['public' => 120, 'standard' => 240, 'admin' => 1000, 'auth' => 40];

    public function handle(Request $request, Closure $next): Response
    {
        $tier = match (true) {
            $request->is('api/v1/auth/login', 'api/v1/auth/register', 'api/v1/auth/synchronize') => 'auth',
            $request->is('api/v1/admin/*', 'api/v1/reports/*', 'api/v1/products/import*') => 'admin',
            $request->bearerToken() !== null => 'standard',
            default => 'public',
        };
        $limit = self::LIMITS[$tier];
        $now = CarbonImmutable::now('UTC');
        $window = $now->startOfMinute()->format('Y-m-d\TH:i:s.v\Z');
        $actor = $request->ip() ?? 'local';
        $id = hash('sha256', $tier.'|'.$actor.'|'.$window);
        $row = Sql::one(
            'INSERT INTO api_rate_limits (id, tier, actor_key, endpoint, limit_per_min, hits, blocked_count, window_start, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
             ON CONFLICT(id) DO UPDATE SET hits = api_rate_limits.hits + 1,
             blocked_count = api_rate_limits.blocked_count + CASE WHEN api_rate_limits.hits >= api_rate_limits.limit_per_min THEN 1 ELSE 0 END,
             updated_at = excluded.updated_at RETURNING hits',
            [$id, $tier, $actor, $request->path(), $limit, $window, Api::now()],
        );
        if (random_int(1, 100) === 1) {
            Sql::run('DELETE FROM api_rate_limits WHERE window_start < ?', [$now->subDay()->format('Y-m-d\TH:i:s.v\Z')]);
        }

        $retryAfter = 60 - $now->second;
        $response = $row['hits'] > $limit
            ? Api::fail("Rate limit exceeded for $tier tier. Try again in {$retryAfter}s.", 429)->header('Retry-After', (string) $retryAfter)
            : $next($request);
        $response->headers->set('X-RateLimit-Limit', (string) $limit);
        $response->headers->set('X-RateLimit-Remaining', (string) max(0, $limit - $row['hits']));
        $response->headers->set('X-RateLimit-Tier', $tier);

        return $response;
    }

    public static function telemetry(): array
    {
        $scopes = ['auth' => 'Login, register, sync', 'public' => 'Health & unauthenticated reads',
            'standard' => 'Cashier & shareholder APIs', 'admin' => 'Admin & manager operations'];
        $tiers = [];
        foreach ($scopes as $tier => $scope) {
            $tiers[] = ['tier' => $tier, 'limit_per_min' => self::LIMITS[$tier], 'scope' => $scope];
        }
        $start = CarbonImmutable::now('UTC')->startOfMinute();
        $rows = Sql::all('SELECT tier, actor_key, hits, blocked_count FROM api_rate_limits WHERE window_start = ? ORDER BY hits DESC LIMIT 20',
            [$start->format('Y-m-d\TH:i:s.v\Z')]);
        $reset = $start->addMinute()->format('Y-m-d\TH:i:s.v\Z');

        return ['tiers' => $tiers, 'active_buckets' => array_map(static fn (array $row) => [
            'key' => $row['tier'].':'.$row['actor_key'], 'hits' => $row['hits'], 'blocked' => $row['blocked_count'], 'reset_at' => $reset,
        ], $rows)];
    }
}
