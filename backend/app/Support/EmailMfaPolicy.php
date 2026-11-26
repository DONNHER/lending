<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class EmailMfaPolicy
{
    public static function enabled(): bool
    {
        if (!self::configurable()) {
            return false;
        }
        $saved = DB::table('security_settings')->where('id', 1)->value('email_mfa_enabled');

        return $saved === null ? config('argivit.email_mfa') : (bool) $saved;
    }

    public static function configurable(): bool
    {
        return !config('argivit.auth_url') && !config('argivit.jwks_url');
    }

    public static function status(): array
    {
        return ['enabled' => self::enabled(), 'can_configure' => self::configurable()];
    }

    public static function save(bool $enabled, array $actor): array
    {
        DB::table('security_settings')->upsert(['id' => 1, 'email_mfa_enabled' => (int) $enabled], ['id'], ['email_mfa_enabled']);
        Api::audit($actor, 'settings.email_mfa_updated', 'system_settings', 'security', ['enabled' => $enabled]);

        return self::status();
    }
}
