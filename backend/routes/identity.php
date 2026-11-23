<?php

use App\Http\Controllers\GovernanceController;
use App\Http\Controllers\IdentityController;
use Illuminate\Support\Facades\Route;

Route::controller(IdentityController::class)->group(function (): void {
    Route::get('/auth/config', 'configuration');
    Route::post('/auth/login', 'login');
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

Route::get('/admin/governance', [GovernanceController::class, 'overview'])->middleware(['argivit.auth', 'argivit.role:admin,manager']);
Route::post('/admin/backups/trigger', [GovernanceController::class, 'backup'])->middleware(['argivit.auth', 'argivit.role:admin']);
