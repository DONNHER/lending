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
    private const GLOBAL_LIMIT = 100;
    private const AUTH_LIMIT = 40;

    public function handle(Request $request, Closure $next): Response
    {
        $tier = match (true) {
            $request->is('api/v1/auth/login', 'api/v1/auth/register', 'api/v1/auth/synchronize', 'api/v1/auth/mfa/verify', 'api/v1/auth/password/*') => 'auth',
            $request->is('api/v1/admin/*', 'api/v1/reports/*', 'api/v1/products/import*') => 'admin',
            $request->bearerToken() !== null => 'standard',
            default => 'public',
        };
        $globalLimit = self::globalLimit();
        $tierLimit = $tier === 'auth' ? min(self::AUTH_LIMIT, $globalLimit) : $globalLimit;
        $now = CarbonImmutable::now('UTC');
        $window = $now->startOfMinute()->format('Y-m-d\TH:i:s.v\Z');
        $actor = $request->ip() ?? 'local';
        $path = $request->path();
        $updated = Api::now();
        $rows = Sql::all(
            'INSERT INTO api_rate_limits (id, tier, actor_key, endpoint, limit_per_min, hits, blocked_count, window_start, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?), (?, ?, ?, ?, ?, 1, 0, ?, ?)
             ON CONFLICT(id) DO UPDATE SET hits = api_rate_limits.hits + 1,
             blocked_count = api_rate_limits.blocked_count + CASE WHEN api_rate_limits.hits >= excluded.limit_per_min THEN 1 ELSE 0 END,
             limit_per_min = excluded.limit_per_min, updated_at = excluded.updated_at RETURNING tier, hits',
            [hash('sha256', 'global|'.$actor.'|'.$window), 'global', $actor, $path, $globalLimit, $window, $updated,
                hash('sha256', $tier.'|'.$actor.'|'.$window), $tier, $actor, $path, $tierLimit, $window, $updated],
        );
        $hits = array_column($rows, 'hits', 'tier');
        if (random_int(1, 100) === 1) {
            Sql::run('DELETE FROM api_rate_limits WHERE window_start < ?', [$now->subDay()->format('Y-m-d\TH:i:s.v\Z')]);
        }

        $blocked = match (true) {
            $hits['global'] > $globalLimit => 'global',
            $hits[$tier] > $tierLimit => $tier,
            default => null,
        };
        $retryAfter = 60 - $now->second;
        $response = $blocked !== null
            ? Api::fail("Rate limit exceeded for $blocked tier. Try again in {$retryAfter}s.", 429)->header('Retry-After', (string) $retryAfter)
            : $next($request);
        $response->headers->set('X-RateLimit-Limit', (string) ($blocked === 'global' ? $globalLimit : $tierLimit));
        $response->headers->set('X-RateLimit-Remaining', (string) max(0, min($globalLimit - $hits['global'], $tierLimit - $hits[$tier])));
        $response->headers->set('X-RateLimit-Tier', $blocked ?? $tier);

        return $response;
    }

    public static function telemetry(): array
    {
        $scopes = ['global' => 'All API routes per IP', 'auth' => 'Login, registration, email verification & identity sync', 'public' => 'Health & unauthenticated reads',
            'standard' => 'Cashier & shareholder APIs', 'admin' => 'Admin & manager operations'];
        $globalLimit = self::globalLimit();
        $tiers = [];
        foreach ($scopes as $tier => $scope) {
            $tiers[] = ['tier' => $tier, 'limit_per_min' => $tier === 'auth' ? min(self::AUTH_LIMIT, $globalLimit) : $globalLimit, 'scope' => $scope];
        }
        $start = CarbonImmutable::now('UTC')->startOfMinute();
        $rows = Sql::all('SELECT tier, actor_key, hits, blocked_count FROM api_rate_limits WHERE window_start = ? ORDER BY hits DESC LIMIT 20',
            [$start->format('Y-m-d\TH:i:s.v\Z')]);
        $reset = $start->addMinute()->format('Y-m-d\TH:i:s.v\Z');

        return ['tiers' => $tiers, 'active_buckets' => array_map(static fn (array $row) => [
            'key' => $row['tier'].':'.$row['actor_key'], 'hits' => $row['hits'], 'blocked' => $row['blocked_count'], 'reset_at' => $reset,
        ], $rows)];
    }

    private static function globalLimit(): int
    {
        return app()->environment('testing')
            ? max(1, (int) config('argivit.test_api_requests_per_minute', self::GLOBAL_LIMIT))
            : self::GLOBAL_LIMIT;
    }
}
