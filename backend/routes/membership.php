<?php

use App\Http\Controllers\LoansController;
use App\Http\Controllers\ShareholdersController;
use Illuminate\Support\Facades\Route;

Route::middleware('argivit.auth')->group(function () {
    Route::controller(ShareholdersController::class)->group(function () {
        Route::get('shareholders', 'index')->middleware('argivit.role:admin,manager,cashier');
        Route::post('shareholders/register', 'register');
        Route::get('shareholders/me', 'me');
        Route::patch('shareholders/me', 'update');
        Route::post('shareholder-documents', 'submitDocument');
        Route::get('shareholders/{id}/documents', 'documents');
        Route::get('documents/{id}/download', 'downloadDocument');
        Route::post('documents/{id}/review', 'reviewDocument')->middleware('argivit.role:admin,manager');
        Route::post('shareholders/{id}/verify', 'verify')->middleware('argivit.role:admin,manager');
        Route::post('shareholders/{id}/share-capital/payments', 'recordCapitalPayment')->middleware('argivit.role:admin,manager');
        Route::get('share-capital/me', 'capital');
        Route::post('share-capital/payments', 'submitCapitalPayment');
        Route::post('share-capital/{id}/verify-payment', 'verifyCapitalPayment')->middleware('argivit.role:admin,manager');
    });

    Route::prefix('loans')->controller(LoansController::class)->group(function () {
        Route::get('eligibility', 'eligibility');
        Route::get('dashboard', 'dashboard');
        Route::get('applications/me', 'myApplications');
        Route::post('applications', 'apply');
        Route::post('applications/{id}/review', 'review')->middleware('argivit.role:admin,manager');
        Route::post('{id}/disburse', 'disburse')->middleware('argivit.role:admin,manager');
        Route::get('{id}/schedule', 'schedule');
        Route::get('{id}/history', 'history');
        Route::post('{id}/payments', 'payment')->middleware('argivit.role:manager');
        Route::post('{id}/simulate-overdue', 'overdue')->middleware('argivit.role:admin,manager');
    });
});
