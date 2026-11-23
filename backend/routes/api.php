<?php

use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json([
    'success' => true,
    'application' => 'Argivit Store API',
    'status' => 'online',
]));

require __DIR__.'/identity.php';
require __DIR__.'/inventory.php';
require __DIR__.'/commerce.php';
require __DIR__.'/membership.php';
