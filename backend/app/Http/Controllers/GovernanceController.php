<?php

namespace App\Http\Controllers;

use App\Http\Middleware\ApiRateLimit;
use App\Support\Api;
use App\Support\PrivateBackups;
use App\Support\Sql;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class GovernanceController extends Controller
{
    public function overview(): JsonResponse
    {
        $imports = Sql::all('SELECT * FROM import_logs ORDER BY created_at DESC LIMIT 25');
        foreach ($imports as &$entry) {
            $entry['failures'] = json_decode($entry['failures_json'], true) ?? [];
        }
        unset($entry);
        $path = DB::connection()->getDatabaseName();
        $size = DB::connection()->getDriverName() === 'pgsql'
            ? (int) (Sql::one('SELECT pg_database_size(current_database()) AS size')['size'] ?? 0)
            : (is_file($path) ? filesize($path) : 0);

        return Api::ok('Admin governance and system health telemetry retrieved.', [
            'import_logs' => $imports,
            'export_logs' => Sql::all('SELECT * FROM export_logs ORDER BY created_at DESC LIMIT 25'),
            'backups' => Sql::all('SELECT * FROM backup_monitoring ORDER BY created_at DESC LIMIT 20'),
            'scheduled_tasks' => Sql::all('SELECT * FROM scheduled_tasks ORDER BY task_name'),
            'rate_limits' => ApiRateLimit::telemetry(),
            'system_health' => [
                'database_size_bytes' => $size,
                'total_products' => DB::table('products')->count(),
                'total_sales' => DB::table('sales')->count(),
                'total_audit_logs' => DB::table('audit_logs')->count(),
                'retention_policy' => '30 days for scheduled backups',
                'backup_schedule' => 'Sunday 02:00 database · Sunday 03:00 uploads · First day 01:00 full (Manila)',
            ],
        ]);
    }

    public function backup(Request $request): JsonResponse
    {
        $result = PrivateBackups::run('database', Api::actor($request), scheduled: false);
        $filename = $result['filename'];
        unset($result['filename']);

        if ($result['status'] !== 'verified') {
            return Api::fail('Database backup failed. Check backup storage and PostgreSQL backup tools.', 503);
        }

        return Api::ok('Manual database backup '.$filename.' verified.', $result, null, 201);
    }
}
