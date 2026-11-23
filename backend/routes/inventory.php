<?php

use App\Http\Controllers\InventoryController;
use App\Http\Controllers\ReportsController;
use Illuminate\Support\Facades\Route;

Route::middleware('argivit.auth')->group(function (): void {
    Route::get('/products/search', [InventoryController::class, 'search']);
    Route::get('/products', [InventoryController::class, 'index']);
    Route::get('/products/import-logs', [InventoryController::class, 'importLogs'])->middleware('argivit.role:admin,manager');
    Route::get('/products/{id}', [InventoryController::class, 'show']);
    Route::get('/inventory/meta', [InventoryController::class, 'metadata']);
    Route::get('/inventory/balances', [InventoryController::class, 'balances']);
    Route::get('/inventory/movements', [InventoryController::class, 'movements']);

    Route::middleware('argivit.role:admin,manager')->group(function (): void {
        Route::post('/products', [InventoryController::class, 'create']);
        Route::patch('/products/{id}', [InventoryController::class, 'update']);
        Route::post('/products/import', [InventoryController::class, 'import']);
        Route::post('/inventory/receipts', [InventoryController::class, 'receive']);
        Route::post('/inventory/adjustments', [InventoryController::class, 'adjust']);

        Route::get('/reports/overview', [ReportsController::class, 'overview']);
        Route::get('/reports/export-logs', [ReportsController::class, 'exportLogs']);
        Route::post('/reports/export-logs', [ReportsController::class, 'logExport']);
    });
});
