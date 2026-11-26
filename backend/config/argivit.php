<?php

$emailMfa = (bool) env('ARGIVIT_EMAIL_MFA', false);
$authUrl = $emailMfa ? '' : rtrim((string) env('AUTH_BASE_URL', ''), '/');

return [
    'version' => env('APP_VERSION', 'dev'),
    'jwt_secret' => env('JWT_SECRET'),
    'auth_url' => $authUrl ?: null,
    'data_api_url' => env('DATA_API_URL'),
    'jwks_url' => $emailMfa ? null : (env('AUTH_JWKS_URL') ?: ($authUrl ? $authUrl.'/jwks' : null)),
    'jwt_issuer' => $authUrl ? (env('AUTH_JWT_ISSUER') ?: $authUrl) : env('AUTH_JWT_ISSUER'),
    'jwt_audience' => env('AUTH_JWT_AUDIENCE'),
    'allow_demo_auth' => env('ARGIVIT_ALLOW_DEMO_AUTH', false),
    'email_mfa' => $emailMfa,
    'web_url' => env('ARGIVIT_WEB_URL'),
    'notification_stream' => (bool) env('ARGIVIT_NOTIFICATION_STREAM', false),
    'test_api_requests_per_minute' => env('ARGIVIT_TEST_API_REQUESTS_PER_MINUTE', 100),
    'backup_directory' => env('ARGIVIT_BACKUP_DIRECTORY', storage_path('app/private/backups')),
    'pg_dump' => env('ARGIVIT_PG_DUMP', 'pg_dump'),
    'pg_restore' => env('ARGIVIT_PG_RESTORE', 'pg_restore'),
];
