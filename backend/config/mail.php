<?php

return [
    'default' => 'smtp',
    'mailers' => [
        'smtp' => [
            'transport' => 'smtp',
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => (int) env('MAIL_PORT', 1025),
            'scheme' => env('MAIL_SCHEME', 'smtp'),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'require_tls' => (bool) env('MAIL_REQUIRE_TLS', true),
            'timeout' => 8,
        ],
    ],
    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'argivit@example.test'),
        'name' => env('MAIL_FROM_NAME', 'Argivit Store'),
    ],
];
