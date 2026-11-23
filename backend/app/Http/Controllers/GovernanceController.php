<?php

namespace App\Http\Controllers;

use App\Http\Middleware\ApiRateLimit;
use App\Support\Api;
use App\Support\Sql;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use PDO;
use Symfony\Component\Process\Process;
use Throwable;

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
                'retention_policy' => '7 daily · 4 weekly · 12 monthly',
                'backup_schedule' => 'Daily 02:00 AM · Weekly Sunday',
            ],
        ]);
    }

    public function backup(Request $request): JsonResponse
    {
        $start = hrtime(true);
        $actor = Api::actor($request);
        $now = Api::now();
        $id = Api::id('bak');
        $directory = config('argivit.backup_directory');
        File::ensureDirectoryExists($directory, 0700);
        $postgres = DB::connection()->getDriverName() === 'pgsql';
        $filename = 'argivit-manual-'.substr($now, 0, 10).'-'.substr($id, 4).($postgres ? '.dump' : '.sqlite');
        $destination = $directory.DIRECTORY_SEPARATOR.$filename;
        if ($postgres) {
            if (!$this->dumpPostgres($destination)) {
                File::delete($destination);
                return Api::fail('PostgreSQL backup failed. Check the direct connection and the server’s pg_dump and pg_restore installations.', 503);
            }
            $healthy = true;
        } else {
            $pdo = DB::connection()->getPdo();
            $statement = $pdo->prepare('VACUUM INTO ?');
            $statement->execute([$destination]);
            $backup = new PDO('sqlite:'.$destination);
            $healthy = $backup->query('PRAGMA quick_check')->fetchColumn() === 'ok';
        }
        $size = filesize($destination);
        $status = $healthy ? 'verified' : 'warning';
        $duration = (int) round((hrtime(true) - $start) / 1_000_000);
        $notes = $postgres ? 'PostgreSQL archive manifest verified.' : ($healthy ? 'SQLite quick_check passed.' : 'SQLite quick_check returned a warning.');

        DB::transaction(function () use ($actor, $id, $now, $filename, $size, $status, $duration, $healthy, $notes): void {
            DB::table('backup_monitoring')->insert([
                'id' => $id, 'backup_type' => 'manual_full', 'storage_location' => 'Private local backup: '.$filename,
                'size_bytes' => $size, 'status' => $status, 'retention_tier' => '7 daily', 'triggered_by' => $actor['name'],
                'notes' => $notes, 'created_at' => $now,
            ]);
            Sql::run('UPDATE scheduled_tasks SET last_run_at = ?, last_status = ?, last_duration_ms = ? WHERE task_name = ?',
                [$now, $healthy ? 'healthy' : 'warning', $duration, 'backup:run']);
            Api::audit($actor, 'system.backup_created', 'backup_monitoring', $id,
                ['backup_type' => 'manual_full', 'size_bytes' => $size, 'status' => $status]);
        });

        return Api::ok('Manual database backup '.$filename.' '.$status.'.', [
            'id' => $id, 'backup_type' => 'manual_full', 'size_bytes' => $size, 'status' => $status, 'created_at' => $now,
        ], null, 201);
    }

    private function dumpPostgres(string $destination): bool
    {
        try {
            $connection = DB::connection(DB::getDefaultConnection() === 'pgsql_docker' ? 'pgsql_docker' : 'pgsql_direct');
            $config = $connection->getConfig();
            $env = [
                'PGHOST' => $config['host'], 'PGPORT' => (string) $config['port'],
                'PGDATABASE' => $config['database'], 'PGUSER' => $config['username'],
                'PGPASSWORD' => $config['password'], 'PGSSLMODE' => $config['sslmode'] ?? 'require',
                'PGCONNECT_TIMEOUT' => '10',
            ];
            if (!empty($config['channel_binding'])) {
                $env['PGCHANNELBINDING'] = $config['channel_binding'];
            }
            $dump = new Process([config('argivit.pg_dump'), '--no-password', '--format=custom',
                '--schema=argivit', '--no-owner', '--no-acl', '--file='.$destination], null, $env, timeout: 60);
            $verification = new Process([config('argivit.pg_restore'), '--list', $destination], timeout: 15);
            return $dump->run() === 0 && $verification->run() === 0 && filesize($destination) > 0;
        } catch (Throwable) {
            return false;
        }
    }
}
