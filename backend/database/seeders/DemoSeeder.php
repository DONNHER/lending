<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class DemoSeeder extends Seeder
{
    public function run(): void
    {
        if (!app()->environment('local', 'testing')) {
            throw new RuntimeException('Load demo accounts only into a local or test environment.');
        }

        $this->callWith(DatabaseSeeder::class, ['demo' => true]);
        DB::transaction(function (): void {
            if (DB::table('users')->exists()) {
                throw new RuntimeException('Demo data requires a database without user accounts.');
            }

            $tables = json_decode(file_get_contents(__DIR__.'/demo.json'), true, flags: JSON_THROW_ON_ERROR);
            foreach ($tables as $table => $rows) {
                if ($table === 'users') {
                    foreach ($rows as &$row) {
                        $row['password_hash'] = password_hash('Argivit2026!', PASSWORD_DEFAULT);
                    }
                    unset($row);
                }
                DB::table($table)->insert($rows);
            }
        });
    }
}
