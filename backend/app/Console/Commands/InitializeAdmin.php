<?php

namespace App\Console\Commands;

use App\Support\Api;
use App\Support\Sessions;
use App\Support\Sql;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class InitializeAdmin extends Command
{
    protected $signature = 'argivit:initialize-admin {email}';

    protected $description = 'Create the first administrator using a password supplied on standard input';

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        $password = stream_isatty(STDIN)
            ? (string) $this->secret('Initial administrator password')
            : rtrim((string) fgets(STDIN), "\r\n");
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 16 || strlen($password) > 72
            || str_contains($password, "\0") || !preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password)
            || !preg_match('/[0-9]/', $password) || !preg_match('/[^A-Za-z0-9]/', $password)) {
            $this->error('Enter a valid email and a strong password between 16 and 72 bytes.');

            return self::INVALID;
        }

        $created = Sql::serialized(Sql::REGISTER_WRITES, static function () use ($email, $password): bool {
            if (DB::table('users')->where('role', 'admin')->exists() || Sessions::userBy('email', $email) !== null) {
                return false;
            }
            $id = Api::id('usr');
            DB::table('users')->insert([
                'id' => $id, 'auth_user_id' => 'local-'.Str::uuid(), 'name' => 'Store Administrator',
                'email' => $email, 'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => 'admin', 'account_status' => 'active', 'created_at' => Api::now(),
            ]);
            DB::table('role_user')->insert(['user_id' => $id, 'role_id' => 'role-admin']);
            Api::audit(['id' => 'laravel-cli', 'name' => 'Laravel command line'], 'user.created', 'user', $id);

            return true;
        });

        if (!$created) {
            $this->error('An administrator or the specified account already exists.');

            return self::FAILURE;
        }
        $this->info('Initial administrator created.');

        return self::SUCCESS;
    }
}
