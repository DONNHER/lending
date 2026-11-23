<?php

return [
    'disk' => env('DOCUMENT_STORAGE_DISK', in_array(env('APP_ENV'), ['local', 'testing'], true) ? 'local' : 's3'),
    'local_root' => env('DOCUMENT_STORAGE_LOCAL_PATH', storage_path('app/private/shareholder-documents')),
    'bucket' => env('DOCUMENT_STORAGE_BUCKET', 'shareholder-documents'),
    'endpoint' => env('AWS_ENDPOINT_URL_S3'),
    'region' => env('AWS_REGION'),
    'key' => env('AWS_ACCESS_KEY_ID'),
    'secret' => env('AWS_SECRET_ACCESS_KEY'),
];
