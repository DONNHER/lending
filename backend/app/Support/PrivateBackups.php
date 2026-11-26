<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use PDO;
use RuntimeException;
use Symfony\Component\Process\Process;
use Throwable;
use ZipArchive;

final class PrivateBackups
{
    public static function run(string $mode, array $actor, bool $scheduled = true): array
    {
        $started = hrtime(true);
        $now = Api::now();
        $id = Api::id('bak');
        $directory = config('argivit.backup_directory');
        File::ensureDirectoryExists($directory, 0700);

        $postgres = DB::connection()->getDriverName() === 'pgsql';
        $databaseExtension = $postgres ? '.dump' : '.sqlite';
        $type = $scheduled ? 'scheduled_'.$mode : 'manual_full';
        $prefix = $scheduled ? 'argivit-'.$type : 'argivit-manual';
        $filename = $prefix.'-'.substr($now, 0, 10).'-'.substr($id, 4).($mode === 'database' ? $databaseExtension : '.zip');
        $destination = $directory.DIRECTORY_SEPARATOR.$filename;
        $notes = null;
        $status = 'failed';
        $bytes = 0;
        try {
            if ($mode === 'database') {
                self::database($destination, $postgres);
                $notes = $postgres ? 'PostgreSQL archive manifest verified.' : 'SQLite quick_check passed.';
            } else {
                self::archive($destination, $mode === 'full', $postgres, $databaseExtension);
                $notes = 'Archive opened and all entries passed checksum verification.';
            }
            $bytes = filesize($destination);
            $status = 'verified';
        } catch (Throwable $error) {
            File::delete($destination);
            $notes = 'Backup creation or verification failed. Check backup storage and database tools.';
            logger()->warning('Private backup failed.', ['mode' => $mode, 'error_type' => $error::class]);
        }

        $duration = (int) round((hrtime(true) - $started) / 1_000_000);
        $result = ['id' => $id, 'backup_type' => $type, 'size_bytes' => $bytes, 'status' => $status, 'created_at' => $now];
        DB::transaction(function () use ($result, $id, $actor, $duration, $filename, $notes, $scheduled, $mode): void {
            DB::table('backup_monitoring')->insert($result + [
                'storage_location' => 'Private local backup: '.$filename,
                'retention_tier' => $scheduled ? '30 days' : 'Manual',
                'triggered_by' => $actor['name'], 'notes' => $notes,
            ]);
            $task = $mode === 'database' ? 'backup:run' : 'backup:'.$mode;
            if ($scheduled) {
                self::track($task, $result['status'] === 'verified', $duration);
            }
            Api::audit($actor, $result['status'] === 'verified' ? 'system.backup_created' : 'system.backup_failed',
                'backup_monitoring', $id, ['backup_type' => $result['backup_type'], 'size_bytes' => $result['size_bytes'], 'status' => $result['status']]);
        });

        return $result + ['filename' => $filename];
    }

    public static function prune(): int
    {
        $now = now('UTC');
        $expired = 0;
        $directory = config('argivit.backup_directory');
        $rows = DB::table('backup_monitoring')->where('status', 'verified')
            ->whereIn('backup_type', ['scheduled_database', 'scheduled_uploads', 'scheduled_full'])
            ->where('created_at', '<', $now->subDays(30)->format('Y-m-d\TH:i:s.v\Z'))
            ->select(['id', 'storage_location'])->lazyById(100);

        foreach ($rows as $row) {
            if (!preg_match('/\APrivate local backup: (argivit-scheduled_(?:database|uploads|full)-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.(?:dump|sqlite|zip))\z/', $row->storage_location, $match)) {
                continue;
            }
            $path = $directory.DIRECTORY_SEPARATOR.$match[1];
            if (is_file($path) && !File::delete($path)) {
                throw new RuntimeException('Could not remove an expired scheduled backup.');
            }
            DB::table('backup_monitoring')->where('id', $row->id)->update(['status' => 'expired']);
            $expired++;
        }

        return $expired;
    }

    public static function track(string $task, bool $success, int $duration): void
    {
        [$frequency, $description] = match ($task) {
            'backup:run' => ['Sunday 02:00', 'Verified database backup'],
            'backup:uploads' => ['Sunday 03:00', 'Verified member documents archive'],
            'backup:full' => ['First day of the month 01:00', 'Verified database and member documents archive'],
            'backup:clean' => ['Daily 05:00', 'Expire scheduled backups after 30 days'],
        };
        DB::table('scheduled_tasks')->upsert([
            'id' => 'task-'.str_replace(':', '-', $task), 'task_name' => $task, 'frequency' => $frequency,
            'description' => $description, 'last_run_at' => Api::now(), 'last_status' => $success ? 'healthy' : 'failed',
            'last_duration_ms' => $duration,
        ], ['task_name'], ['frequency', 'description', 'last_run_at', 'last_status', 'last_duration_ms']);
    }

    private static function database(string $file, bool $postgres): void
    {


        if (!$postgres) {
            $statement = DB::connection()->getPdo()->prepare('VACUUM INTO ?');
            $statement->execute([$file]);
            $db = new PDO('sqlite:'.$file);
            if ($db->query('PRAGMA quick_check')->fetchColumn() !== 'ok') {
                throw new RuntimeException('SQLite backup integrity check failed.');
            }

            return;
        }

        $name = env('DATABASE_URL_UNPOOLED') ? 'pgsql_direct' : DB::getDefaultConnection();
        $config = DB::connection($name)->getConfig();
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
            '--schema=argivit', '--no-owner', '--no-acl', '--file='.$file], null, $env, timeout: 120);
        $verify = new Process([config('argivit.pg_restore'), '--list', $file], timeout: 15);
        if ($dump->run() !== 0 || $verify->run() !== 0 || filesize($file) === 0) {
            throw new RuntimeException('PostgreSQL backup or verification failed.');
        }
    }

    private static function archive(string $destination, bool $database, bool $postgres, string $extension): void
    {
        $zip = new ZipArchive();
        $parts = [];
        $checksums = [];
        try {
            if ($database) {
                $dbFile = self::stage($destination, $parts);
                File::delete($dbFile);
                self::database($dbFile, $postgres);
                $checksums['argivit'.$extension] = hash_file('sha256', $dbFile);
            }
            $keys = DB::table('shareholder_documents')->select('file_path')->distinct()->orderBy('file_path')->cursor();
            foreach ($keys as $row) {
                $key = $row->file_path;
                if (!VerificationDocuments::hasFile($key)) {
                    continue;
                }
                $source = VerificationDocuments::open($key);
                if ($source === null) {
                    throw new RuntimeException('An uploaded document could not be found.');
                }
                try {
                    $file = self::stage($destination, $parts);
                    $target = fopen($file, 'wb');
                    if ($target === false) {
                        throw new RuntimeException('Could not stage the uploaded document.');
                    }
                    try {
                        $copied = stream_copy_to_stream($source, $target);
                        if ($copied === false || $copied === 0) {
                            throw new RuntimeException('Could not copy the uploaded document.');
                        }
                    } finally {
                        fclose($target);
                    }
                    $checksums[$key] = hash_file('sha256', $file);
                } finally {
                    fclose($source);
                }
            }

            if ($zip->open($destination, ZipArchive::CREATE | ZipArchive::EXCL) !== true) {
                throw new RuntimeException('Could not open the archive.');
            }
            foreach (array_keys($checksums) as $index => $name) {
                if (!$zip->addFile($parts[$index], $name)) {
                    throw new RuntimeException('Could not add a backup file.');
                }
            }
            if (!$zip->addFromString('manifest.json', json_encode((object) $checksums, JSON_THROW_ON_ERROR)) || !$zip->close()) {
                throw new RuntimeException('Could not finish the archive.');
            }
            if ($zip->open($destination, ZipArchive::CHECKCONS) !== true) {
                throw new RuntimeException('Could not reopen the archive.');
            }
            try {
                foreach ($checksums as $name => $expected) {
                    $stream = $zip->getStream($name);
                    if ($stream === false) {
                        throw new RuntimeException('Expected archive entry is missing.');
                    }
                    try {
                        $hash = hash_init('sha256');
                        hash_update_stream($hash, $stream);
                        if (hash_final($hash) !== $expected) {
                            throw new RuntimeException('Archive entry checksum mismatch.');
                        }
                    } finally {
                        fclose($stream);
                    }
                }
            } finally {
                $zip->close();
            }
        } finally {
            File::delete($parts);
        }
    }

    private static function stage(string $destination, array &$parts): string
    {
        $file = tempnam(dirname($destination), '.argivit-');
        if ($file === false) {
            throw new RuntimeException('Could not create a temporary backup file.');
        }
        $parts[] = $file;

        return $file;
    }
}
