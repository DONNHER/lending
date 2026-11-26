<?php

namespace Database\Seeders;

use App\Support\Sessions;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class DemoSeeder extends Seeder
{
    public function run(bool $accountsOnly = false): void
    {
        if (!app()->environment('local', 'testing')) {
            throw new RuntimeException('Load demo accounts only into a local or test environment.');
        }

        if ($accountsOnly && (config('argivit.auth_url')
            || (DB::connection()->getDriverName() !== 'sqlite' && !Sessions::allowsLocalDockerAuth()))) {
            throw new RuntimeException('Demo accounts require SQLite or local Docker PostgreSQL with password sign-in.');
        }
        DB::transaction(function () use ($accountsOnly): void {
            if (DB::table('users')->exists()) {
                throw new RuntimeException('Demo data requires a database without user accounts.');
            }

            $this->callWith(DatabaseSeeder::class, ['demo' => !$accountsOnly]);
            $tables = json_decode(file_get_contents(__DIR__.'/demo.json'), true, flags: JSON_THROW_ON_ERROR);
            if ($accountsOnly) {
                $tables = array_intersect_key($tables, array_flip(['users', 'shareholder_profiles', 'share_capital_accounts', 'role_user']));
                foreach ($tables['shareholder_profiles'] as &$profile) {
                    $profile = array_replace($profile, ['verification_status' => 'incomplete', 'approved_at' => null, 'approved_by' => null]);
                }
                unset($profile);
                $requiredCapital = DB::table('share_capital_settings')->value('required_initial_capital');
                foreach ($tables['share_capital_accounts'] as &$account) {
                    $account = array_replace($account, ['status' => 'unpaid', 'fully_paid_at' => null, 'required_amount' => $requiredCapital]);
                }
                unset($account);
            }
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
