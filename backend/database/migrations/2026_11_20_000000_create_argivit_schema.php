<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $schema = file_get_contents(database_path('schema/argivit.sql'));
        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared($schema);

            return;
        }
        $schema = preg_replace('/\bREAL\b/', 'DOUBLE PRECISION', $schema);

        DB::unprepared('CREATE SCHEMA IF NOT EXISTS argivit');
        DB::unprepared('REVOKE ALL ON SCHEMA argivit FROM PUBLIC');

        // LOCAL lasts only until this migration's transaction ends
        DB::unprepared('SET LOCAL search_path TO argivit');
        DB::unprepared($schema);
    }

    public function down(): void
    {
        throw new LogicException('This migration adopts existing ledger tables. Restore a database backup to roll back.');
    }
};
