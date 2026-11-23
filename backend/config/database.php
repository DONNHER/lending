<?php

$default = env('DB_CONNECTION', env('DATABASE_URL') || env('DATABASE_URL_UNPOOLED') ? 'pgsql' : 'sqlite');
$postgres = [
    'driver' => 'pgsql',
    'host' => env('DB_PGSQL_HOST', env('DB_HOST', '127.0.0.1')),
    'port' => env('DB_PGSQL_PORT', env('DB_PORT', '5432')),
    'database' => env('DB_PGSQL_DATABASE', env('DB_DATABASE', 'argivit')),
    'username' => env('DB_PGSQL_USERNAME', env('DB_USERNAME', 'postgres')),
    'password' => env('DB_PGSQL_PASSWORD', env('DB_PASSWORD', '')),
    'charset' => 'utf8',
    'search_path' => 'argivit',
    'sslmode' => env('DB_SSLMODE', 'require'),
    'sslrootcert' => env('DB_SSLROOTCERT'),
];

return [
    'default' => $default,
    'connections' => [
        'sqlite' => [
            'driver' => 'sqlite',
            'url' => env('DB_URL'),
            'database' => env('DB_SQLITE_DATABASE', env('DB_DATABASE', database_path('argivit.sqlite'))),
            'foreign_key_constraints' => true,
            'busy_timeout' => 5000,
            'journal_mode' => 'wal',
            'transaction_mode' => 'IMMEDIATE',
        ],
        'pgsql' => ['url' => env('DATABASE_URL', env('DATABASE_URL_UNPOOLED', env('DB_URL')))] + $postgres,
        'pgsql_direct' => ['url' => env('DATABASE_URL_UNPOOLED')] + $postgres,
        'pgsql_docker' => [
            'host' => '127.0.0.1',
            'port' => env('DOCKER_PG_PORT', '55432'),
            'database' => env('DOCKER_PG_DATABASE', 'argivit'),
            'username' => env('DOCKER_PG_USERNAME', 'argivit'),
            'password' => env('DOCKER_PG_PASSWORD', ''),
            'sslmode' => 'disable',
            'sslrootcert' => null,
        ] + $postgres,
    ],
    // Keep migration tracking at a fixed path while the first migration creates the app schema.
    'migrations' => [
        'table' => in_array($default, ['pgsql', 'pgsql_direct', 'pgsql_docker'], true) ? 'public.argivit_migrations' : 'migrations',
        'update_date_on_publish' => true,
    ],
];
