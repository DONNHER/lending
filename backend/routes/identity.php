<?php

use App\Http\Controllers\AccountSecurityController;
use App\Http\Controllers\GovernanceController;
use App\Http\Controllers\IdentityController;
use App\Http\Controllers\SecuritySettingsController;
use Illuminate\Support\Facades\Route;

Route::controller(IdentityController::class)->group(function (): void {
    Route::get('/auth/config', 'configuration');
    Route::post('/auth/login', 'login');
    Route::post('/auth/mfa/verify', 'verifyEmailMfa');
    Route::post('/auth/register', 'register');
    Route::post('/auth/synchronize', 'synchronize');

    Route::middleware('argivit.auth')->group(function (): void {
        Route::get('/auth/me', 'me');
        Route::post('/auth/logout', 'logout');
        Route::delete('/admin/impersonation', 'endImpersonation');
        Route::get('/admin/settings', 'settings');

        Route::middleware('argivit.role:admin,manager')->group(function (): void {
            Route::get('/users', 'users');
            Route::get('/admin/audit-logs', 'auditLog');
            Route::patch('/admin/settings', 'updateSettings');
        });

        Route::middleware('argivit.role:admin')->group(function (): void {
            Route::patch('/users/{id}/status', 'updateStatus');
            Route::patch('/users/{id}/role', 'updateRole');
            Route::post('/admin/impersonation', 'startImpersonation');
        });
    });
});


Route::controller(AccountSecurityController::class)->group(function (): void {
    Route::post('/auth/password/forgot', 'requestReset');
    Route::post('/auth/password/reset', 'reset');

    Route::middleware('argivit.auth')->group(function (): void {
        Route::post('/auth/session/activity', 'activity');
        Route::get('/auth/sessions', 'sessions');
        Route::delete('/auth/sessions/{session}', 'revokeSession');
    });

    Route::middleware(['argivit.auth', 'argivit.role:admin'])->group(function (): void {
        Route::post('/admin/users/{id}/password-reset', 'adminReset');
        Route::post('/admin/users/{id}/force-logout', 'forceLogout');
        Route::get('/admin/users/{id}/sessions', 'userSessions');
    });
});

Route::get('/admin/governance', [GovernanceController::class, 'overview'])->middleware(['argivit.auth', 'argivit.role:admin,manager']);
Route::post('/admin/backups/trigger', [GovernanceController::class, 'backup'])->middleware(['argivit.auth', 'argivit.role:admin']);
Route::middleware(['argivit.auth', 'argivit.role:admin'])->controller(SecuritySettingsController::class)->group(function (): void {
    Route::get('/admin/security/email-mfa', 'show');
    Route::post('/admin/security/email-mfa/challenge', 'challenge');
    Route::patch('/admin/security/email-mfa', 'update');
});
