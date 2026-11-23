<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

final class Api
{
    public static function ok(string $message, mixed $data = null, mixed $meta = null, int $status = 200): JsonResponse
    {
        return response()->json(['success' => true, 'message' => $message, 'data' => $data, 'meta' => $meta], $status);
    }

    public static function fail(string $message, int $status = 400, ?array $errors = null): JsonResponse
    {
        $body = ['success' => false, 'message' => $message, 'data' => null, 'meta' => null];
        if ($errors !== null) {
            $body['errors'] = $errors;
        }

        return response()->json($body, $status);
    }

    public static function actor(Request $request): array
    {
        return $request->attributes->get('argivit.actor', []);
    }

    public static function id(string $prefix): string
    {
        return $prefix.'-'.bin2hex(random_bytes(4));
    }

    public static function now(): string
    {
        return CarbonImmutable::now('UTC')->format('Y-m-d\TH:i:s.v\Z');
    }

    public static function audit(array $actor, string $action, string $entityType, string $entityId, array $metadata = []): void
    {
        Sql::run(
            'INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [(string) Str::uuid(), $actor['id'], $actor['name'], $action, $entityType, $entityId,
                json_encode((object) $metadata, JSON_THROW_ON_ERROR), self::now()],
        );
    }
}
