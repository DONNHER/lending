<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\DB;

final class Sql
{
    public const REGISTER_WRITES = 1;
    public const LOAN_WRITES = 2;

    public static function serialized(int $scope, Closure $operation, int $attempts = 3): mixed
    {
        // SQLite's immediate transaction serializes writers. On Postgres, keep each ledger's
        // read-then-write checks atomic without blocking unrelated application writes.
        return DB::transaction(static function () use ($scope, $operation): mixed {
            if (DB::connection()->getDriverName() === 'pgsql') {
                DB::selectOne('SELECT pg_advisory_xact_lock(742931, CAST(? AS INTEGER))', [$scope]);
            }

            return $operation();
        }, $attempts);
    }

    public static function rowSequence(string $alias = ''): string
    {
        return $alias.(DB::connection()->getDriverName() === 'sqlite' ? 'rowid' : 'id');
    }

    public static function dateRange(string $expression): string
    {
        return DB::connection()->getDriverName() === 'pgsql'
            ? "CAST($expression AS TIMESTAMPTZ) BETWEEN CAST(? AS TIMESTAMPTZ) AND CAST(? AS TIMESTAMPTZ)"
            : "julianday($expression) BETWEEN julianday(?) AND julianday(?)";
    }

    public static function all(string $query, array $bindings = []): array
    {
        return array_map(static fn ($row) => (array) $row, DB::select($query, $bindings));
    }

    public static function one(string $query, array $bindings = []): ?array
    {
        $row = DB::selectOne($query, $bindings);

        return $row === null ? null : (array) $row;
    }

    public static function run(string $query, array $bindings = []): int
    {
        return DB::affectingStatement($query, $bindings);
    }
}
