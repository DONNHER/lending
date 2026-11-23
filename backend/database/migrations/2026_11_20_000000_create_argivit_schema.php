<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $schema = file_get_contents(database_path('schema/argivit.sql'));
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('CREATE SCHEMA IF NOT EXISTS argivit; REVOKE ALL ON SCHEMA argivit FROM PUBLIC');
            $schema = preg_replace('/\bREAL\b/', 'DOUBLE PRECISION', $schema);
        }
        DB::unprepared($schema);
    }

    public function down(): void
    {
        throw new LogicException('This migration adopts existing ledger tables. Restore a database backup to roll back.');
    }
};
