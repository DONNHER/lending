<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class DatabaseSeeder extends Seeder
{
    public function run(bool $demo = false): void
    {
        DB::transaction(function () use ($demo): void {
            $tables = json_decode(file_get_contents(__DIR__.'/reference.json'), true, flags: JSON_THROW_ON_ERROR);
            if (!$demo && DB::connection()->getDriverName() === 'pgsql') {
                // Start with configuration and the single cashier terminal; omit demo operations.
                unset($tables['pos_devices'], $tables['scheduled_tasks']);
                $tables['suppliers'] = [['id' => 'sup-1', 'name' => 'Local Supplier', 'contact_details' => '']];
                $tables['pos_terminals'] = array_values(array_filter(
                    $tables['pos_terminals'], static fn (array $row) => $row['terminal_code'] === 'TERMINAL-001',
                ));
            }
            foreach ($tables as $table => $rows) {
                DB::table($table)->insertOrIgnore($rows);
            }
        });
    }
}
