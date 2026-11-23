<?php

namespace App\Console\Commands;

use App\Support\Api;
use App\Support\Sessions;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class GrantStoreRole extends Command
{
    protected $signature = 'argivit:grant-role {email : Active account email} {role : admin, manager, or cashier}';

    protected $description = 'Assign a store role to an existing account';

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        $role = (string) $this->argument('role');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !in_array($role, ['admin', 'manager', 'cashier'], true)) {
            $this->error('Enter a valid email and one of: admin, manager, cashier.');
            return self::INVALID;
        }

        $changed = DB::transaction(function () use ($email, $role): bool {
            $user = DB::table('users')->whereRaw('lower(email) = ?', [$email])->lockForUpdate()->first();
            if (!$user || $user->account_status !== 'active') {
                return false;
            }
            DB::table('users')->where('id', $user->id)->update(['role' => $role]);
            DB::table('role_user')->where('user_id', $user->id)->delete();
            DB::table('role_user')->insert(['user_id' => $user->id, 'role_id' => 'role-'.$role]);
            DB::table('user_sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => Api::now()]);
            Api::audit(['id' => 'laravel-cli', 'name' => 'Laravel command line'], 'user.role_updated', 'user', $user->id, ['role' => $role]);
            return true;
        });

        if (!$changed) {
            $this->error('No active account was found. Create the account in Argivit first.');
            return self::FAILURE;
        }
        $this->info('Store role assigned. The user can sign in again to open that workspace.');
        return self::SUCCESS;
    }
}
