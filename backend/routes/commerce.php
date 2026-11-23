<?php

use App\Http\Controllers\CommerceController;
use App\Http\Controllers\SyncController;
use Illuminate\Support\Facades\Route;

Route::middleware('argivit.auth')->group(function (): void {
    Route::get('/shop/products', [CommerceController::class, 'catalog']);
    Route::post('/orders', [CommerceController::class, 'createOrder']);
    Route::get('/orders/me', [CommerceController::class, 'myOrders']);
    Route::get('/orders/{id}', [CommerceController::class, 'showOrder']);
    Route::post('/orders/{id}/confirm', [CommerceController::class, 'confirmOrder']);
    Route::post('/orders/{id}/cancel', [CommerceController::class, 'cancelOrder']);

    Route::middleware('argivit.role:admin,manager,cashier')->group(function (): void {
        Route::get('/orders', [CommerceController::class, 'orders']);
        Route::get('/pos/orders/scan/{token}', [CommerceController::class, 'scanOrder']);
        Route::post('/pos/orders/{id}/fulfill', [CommerceController::class, 'fulfillOrder']);
        Route::post('/pos/checkout', [CommerceController::class, 'checkout']);
        Route::get('/pos/sales', [CommerceController::class, 'sales']);
        Route::post('/pos/returns', [CommerceController::class, 'returnSale']);

        Route::post('/sync/batches', [SyncController::class, 'createBatch']);
        Route::get('/sync/batches/{id}', [SyncController::class, 'showBatch']);
        Route::post('/sync/events', [SyncController::class, 'createEvent']);
        Route::get('/sync/changes', [SyncController::class, 'changes']);
        Route::get('/sync/conflicts', [SyncController::class, 'conflicts']);
    });

    Route::post('/sync/conflicts/{id}/resolve', [SyncController::class, 'resolveConflict'])
        ->middleware('argivit.role:admin,manager');
});
