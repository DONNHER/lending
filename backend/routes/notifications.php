<?php

use App\Http\Controllers\NotificationsController;
use Illuminate\Support\Facades\Route;

Route::middleware('argivit.auth')->controller(NotificationsController::class)->group(function (): void {
    Route::get('/notifications', 'index');
    Route::get('/notifications/events', 'stream');
    Route::post('/notifications/read-all', 'markRead');
    Route::delete('/notifications/{id}', 'dismiss')->whereUuid('id');
    Route::patch('/notifications/preferences', 'preference');
});
