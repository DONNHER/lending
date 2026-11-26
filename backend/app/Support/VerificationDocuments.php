<?php

namespace App\Support;

use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;
use GuzzleHttp\Psr7\StreamWrapper;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

final class VerificationDocuments
{
    private const EXTENSIONS = [
        'application/pdf' => 'pdf',
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
    ];

    public static function objectKey(UploadedFile $file): string
    {
        $extension = self::EXTENSIONS[$file->getMimeType()] ?? throw new RuntimeException('Unsupported verification file.');

        return 'verification/'.Str::uuid().'.'.$extension;
    }

    public static function hasFile(string $key): bool
    {
        return preg_match('/\Averification\/[0-9a-f-]{36}\.(pdf|jpg|png)\z/', $key) === 1;
    }

    public static function originalName(UploadedFile $file, string $key): string
    {
        $original = basename(str_replace('\\', '/', $file->getClientOriginalName()));
        $stem = preg_replace('/[\p{C}\/\\\\]+/u', '', pathinfo($original, PATHINFO_FILENAME));

        return (trim(mb_strcut($stem ?? '', 0, 180, 'UTF-8')) ?: 'verification-document').'.'.pathinfo($key, PATHINFO_EXTENSION);
    }

    public static function store(string $key, UploadedFile $file): void
    {
        $path = $file->getRealPath();
        $stream = $path ? fopen($path, 'rb') : false;
        if ($stream === false) {
            throw new RuntimeException('Could not read the verification file.');
        }

        try {
            if (self::isLocal()) {
                Storage::build(self::localConfig())->writeStream($key, $stream);
            } else {
                self::client()->putObject([
                    ...self::object($key),
                    'Body' => $stream,
                    'ContentType' => $file->getMimeType(),
                    'CacheControl' => 'private, no-store',
                ]);
            }
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }
    }

    /** @return resource|null */
    public static function open(string $key)
    {
        if (!self::hasFile($key)) {
            return null;
        }
        if (self::isLocal()) {
            $disk = Storage::build(self::localConfig());

            return $disk->exists($key) ? $disk->readStream($key) : null;
        }

        try {
            $object = self::client()->getObject(self::object($key) + ['@http' => ['stream' => true]]);

            return StreamWrapper::getResource($object['Body']);
        } catch (S3Exception $error) {
            if ($error->getStatusCode() === 404) {
                return null;
            }

            throw $error;
        }
    }

    public static function discard(string $key): void
    {
        try {
            if (self::isLocal()) {
                Storage::build(self::localConfig())->delete($key);
            } else {
                self::client()->deleteObject(self::object($key));
            }
        } catch (Throwable) {
            // Leave the original failure intact and avoid logging signed requests.
            logger()->warning('A failed verification upload could not be cleaned up.', ['object' => $key]);
        }
    }

    private static function isLocal(): bool
    {
        $disk = config('documents.disk');
        if ($disk === 'local') {
            return true;
        }
        if ($disk !== 's3') {
            throw new RuntimeException('Private verification storage is not configured.');
        }

        return false;
    }

    private static function localConfig(): array
    {
        return ['driver' => 'local', 'root' => config('documents.local_root'), 'visibility' => 'private', 'throw' => true];
    }

    private static function object(string $key): array
    {
        return ['Bucket' => config('documents.bucket'), 'Key' => $key];
    }

    private static function client(): S3Client
    {
        $endpoint = config('documents.endpoint');
        $region = config('documents.region');
        $key = config('documents.key');
        $secret = config('documents.secret');
        if (!is_string($endpoint) || !str_starts_with($endpoint, 'https://') || !$region || !$key || !$secret) {
            throw new RuntimeException('Object Storage is not configured.');
        }

        return new S3Client([
            'version' => 'latest',
            'region' => $region,
            'endpoint' => $endpoint,
            'credentials' => ['key' => $key, 'secret' => $secret],
            'use_path_style_endpoint' => true,
            'request_checksum_calculation' => 'when_required',
            'response_checksum_validation' => 'when_required',
            'http' => ['connect_timeout' => 3, 'timeout' => 20],
        ]);
    }
}
