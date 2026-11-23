<?php

$authUrl = rtrim((string) env('AUTH_BASE_URL', ''), '/');

return [
    'jwt_secret' => env('JWT_SECRET'),
    'auth_url' => $authUrl ?: null,
    'data_api_url' => env('DATA_API_URL'),
    'jwks_url' => $authUrl ? (env('AUTH_JWKS_URL') ?: $authUrl.'/jwks') : env('AUTH_JWKS_URL'),
    'jwt_issuer' => $authUrl ? (env('AUTH_JWT_ISSUER') ?: $authUrl) : env('AUTH_JWT_ISSUER'),
    'jwt_audience' => env('AUTH_JWT_AUDIENCE'),
    'allow_demo_auth' => env('ARGIVIT_ALLOW_DEMO_AUTH', false),
    'backup_directory' => env('ARGIVIT_BACKUP_DIRECTORY', storage_path('app/private/backups')),
    'pg_dump' => env('ARGIVIT_PG_DUMP', 'pg_dump'),
    'pg_restore' => env('ARGIVIT_PG_RESTORE', 'pg_restore'),
];
