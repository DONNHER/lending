<?php

use App\Support\Api;
use App\Support\NotificationInbox;
use App\Support\PrivateBackups;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('argivit:archive-audit', function (): void {
    $now = CarbonImmutable::now('UTC');
    $archived = DB::table('audit_logs')->whereNull('archived_at')
        ->where('created_at', '<', $now->subDays(90)->format('Y-m-d\TH:i:s.v\Z'))
        ->update(['archived_at' => Api::now()]);
    DB::table('sign_in_attempts')->where('expires_at', '<=', $now->getTimestamp())->delete();
    DB::table('password_reset_requests')->where('expires_at', '<=', $now->getTimestamp())->delete();

    $this->info("Archived {$archived} audit records.");
})->purpose('Archive audit records older than 90 days and remove expired password attempt counters.');

Schedule::command('argivit:archive-audit')->dailyAt('04:00')->timezone('Asia/Manila')->withoutOverlapping(10);

Artisan::command('argivit:backup {mode : database, uploads or full}', function (string $mode): int {
    if (!in_array($mode, ['database', 'uploads', 'full'], true)) {
        $this->error('Choose database, uploads or full.');

        return 2;
    }
    $result = PrivateBackups::run($mode, ['id' => 'laravel-scheduler', 'name' => 'Laravel scheduler']);
    $this->info($result['filename'].' '.$result['status']);

    return $result['status'] === 'verified' ? 0 : 1;
})->purpose('Create a private, verified Argivit backup.');

Artisan::command('argivit:prune-backups', function (): void {
    $started = hrtime(true);
    $success = false;
    try {
        $removed = PrivateBackups::prune();
        $success = true;
        $this->info("Expired {$removed} scheduled backup files.");
    } finally {
        PrivateBackups::track('backup:clean', $success, (int) round((hrtime(true) - $started) / 1_000_000));
    }
})->purpose('Expire only Argivit scheduled backups after 30 days.');

Schedule::command('argivit:backup database')->sundays()->at('02:00')->timezone('Asia/Manila')->withoutOverlapping(180);
Schedule::command('argivit:backup uploads')->sundays()->at('03:00')->timezone('Asia/Manila')->withoutOverlapping(180);
Schedule::command('argivit:backup full')->monthlyOn(1, '01:00')->timezone('Asia/Manila')->withoutOverlapping(180);
Schedule::command('argivit:prune-backups')->dailyAt('05:00')->timezone('Asia/Manila')->withoutOverlapping(180);

Artisan::command('argivit:notifications', function (): void {
    NotificationInbox::scheduled();
})->purpose('Send in-app stock, storage and upcoming loan notices.');

Schedule::command('argivit:notifications')->dailyAt('08:00')->timezone('Asia/Manila')->withoutOverlapping(10);
