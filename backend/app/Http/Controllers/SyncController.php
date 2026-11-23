<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\OfflineSales;
use App\Support\Sales;
use App\Support\Sql;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

final class SyncController
{
    private const EVENT_RULES = [
        'event_id' => 'required|string',
        'event_type' => 'required|in:pos.sale.completed',
        'terminal_id' => 'required|string',
        'cashier_id' => 'sometimes|required|string',
        'occurred_at' => 'required|string',
        'payload' => 'required|array',
        'payload.sale_id' => 'required|string',
        'payload.payment_method' => Sales::PAYMENT_RULE,
        'payload.total' => 'required|numeric|min:0',
        'payload.items' => 'required|array|list|min:1',
        'payload.items.*.product_id' => 'required|string',
        'payload.items.*.product_name' => 'required|string',
        'payload.items.*.sku' => 'required|string',
        'payload.items.*.unit_id' => 'required|string',
        'payload.items.*.unit_name' => 'required|string',
        'payload.items.*.quantity' => 'required|numeric|gt:0',
        'payload.items.*.conversion_factor' => 'required|numeric|gt:0',
        'payload.items.*.quantity_base' => 'required|numeric|gt:0',
        'payload.items.*.unit_price' => 'required|numeric|min:0',
        'payload.items.*.line_total' => 'required|numeric|min:0',
    ];

    public function createBatch(Request $request): JsonResponse
    {
        $rules = [
            'terminal_id' => 'required|string',
            'device_identifier' => 'sometimes|nullable|string',
            'events' => 'required|array|list|min:1',
        ];
        foreach (self::EVENT_RULES as $field => $rule) {
            $rules['events.*.'.$field] = $rule;
        }
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            return Api::fail('Invalid sync batch payload.', 422, $validator->errors()->toArray());
        }
        $data = $validator->validated();
        $actor = Api::actor($request);
        $events = [];
        foreach ($data['events'] as $event) {
            $event['payload']['payment_method'] ??= 'cash';
            if (!$this->validRegisterReference($event)) {
                return Api::fail('Invalid sync batch payload.', 422, ['events' => [$this->registerReferenceMessage()]]);
            }
            if ($event['terminal_id'] !== $data['terminal_id'] || ($event['cashier_id'] ?? $actor['id']) !== $actor['id']) {
                return Api::fail('Sync events must belong to this terminal and signed-in cashier.', 403);
            }
            $events[] = $event;
        }
        $result = OfflineSales::process($actor, $data['terminal_id'], $events, $data['device_identifier'] ?? null);

        return Api::ok(
            "Synchronization batch complete: {$result['processed_count']} processed, {$result['duplicate_count']} duplicates, {$result['conflict_count']} conflicts.",
            $result,
        );
    }

    public function showBatch(string $id): JsonResponse
    {
        $batch = Sql::one('SELECT * FROM sync_batches WHERE id = ?', [$id]);
        if ($batch === null) {
            return Api::fail('Sync batch not found.', 404);
        }
        $batch['events'] = Sql::all('SELECT * FROM sync_events WHERE batch_id = ? ORDER BY created_at ASC, '.Sql::rowSequence().' ASC', [$id]);

        return Api::ok('Sync batch retrieved.', $batch);
    }

    public function createEvent(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), self::EVENT_RULES);
        if ($validator->fails()) {
            return Api::fail('Invalid sync event payload.', 422, $validator->errors()->toArray());
        }
        $event = $validator->validated();
        $event['payload']['payment_method'] ??= 'cash';
        if (!$this->validRegisterReference($event)) {
            return Api::fail('Invalid sync event payload.', 422, ['event' => [$this->registerReferenceMessage()]]);
        }
        $actor = Api::actor($request);
        if (($event['cashier_id'] ?? $actor['id']) !== $actor['id']) {
            return Api::fail('Sync events must belong to the signed-in cashier.', 403);
        }
        $result = OfflineSales::process($actor, $event['terminal_id'], [$event], null);
        $single = $result['results'][0];

        return Api::ok("Offline event {$single['status']}.", [
            'batch_id' => $result['batch_id'],
            'sync_cursor' => $result['sync_cursor'],
        ] + $single);
    }

    public function changes(Request $request): JsonResponse
    {
        $values = [];
        foreach (['cursor', 'terminal_id', 'device_id'] as $field) {
            $raw = $request->query($field);
            $values[] = is_string($raw) && trim($raw) !== '' ? trim($raw) : null;
        }

        return Api::ok('Synchronization changes retrieved.', OfflineSales::changes(...$values));
    }

    public function conflicts(): JsonResponse
    {
        return Api::ok('Sync telemetry retrieved.', [
            'conflicts' => Sql::all('SELECT * FROM sync_conflicts ORDER BY created_at DESC'),
            'batches' => Sql::all('SELECT * FROM sync_batches ORDER BY created_at DESC LIMIT 20'),
            'terminals' => Sql::all('SELECT * FROM pos_terminals ORDER BY terminal_code ASC'),
            'devices' => Sql::all('SELECT * FROM device_sync_states ORDER BY updated_at DESC'),
        ]);
    }

    public function resolveConflict(Request $request, string $id): JsonResponse
    {
        $resolution = $request->input('resolution');
        if (!in_array($resolution, ['accepted_negative_adjustment', 'voided'], true)) {
            return Api::fail('Invalid resolution.', 422);
        }
        $actor = Api::actor($request);

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($id, $resolution, $actor): JsonResponse {
            $conflict = Sql::one('SELECT event_id, terminal_id, resolution_status FROM sync_conflicts WHERE id = ?', [$id]);
            if ($conflict === null) {
                return Api::fail('Conflict not found.', 404);
            }
            if ($conflict['resolution_status'] !== 'open') {
                if ($conflict['resolution_status'] !== $resolution) {
                    return Api::fail('Conflict already resolved.');
                }
                if ($resolution === 'voided') {
                    return Api::ok('Sync conflict resolved.', ['id' => $id, 'resolution_status' => $resolution]);
                }
            }

            $now = Api::now();
            $result = ['id' => $id, 'resolution_status' => $resolution];
            $audit = ['resolution' => $resolution];
            if ($resolution === 'accepted_negative_adjustment') {
                $saved = Sql::one('
                    SELECT e.*, (SELECT a.actor_id FROM audit_logs a
                        WHERE a.entity_id = e.batch_id AND a.entity_type = ? AND a.action = ?
                        ORDER BY a.created_at DESC, '.Sql::rowSequence('a.').' DESC LIMIT 1) AS batch_actor_id
                    FROM sync_events e WHERE e.event_id = ? AND e.terminal_id = ?
                ', ['sync_batch', 'sync.batch_processed', $conflict['event_id'], $conflict['terminal_id']]);
                $payload = $saved === null ? null : json_decode($saved['payload_json'], true);
                $validator = Validator::make(is_array($payload) ? $payload : [], self::EVENT_RULES);
                if ($validator->fails()) {
                    return Api::fail('The saved sale is missing or incomplete. It cannot be reconciled.', 409);
                }
                $event = $validator->validated();
                $event['payload']['payment_method'] ??= 'cash';
                if ($event['event_id'] !== $conflict['event_id'] || $event['terminal_id'] !== $conflict['terminal_id']
                    || !$this->validRegisterReference($event)) {
                    return Api::fail('The saved sale does not match this conflict. It cannot be reconciled.', 409);
                }
                $saleId = OfflineSales::acceptConflict($saved, $event, $now);
                $result['central_sale_id'] = $saleId;
                if ($conflict['resolution_status'] === $resolution && $saved['central_sale_id'] === $saleId) {
                    return Api::ok('Sync conflict resolved.', $result);
                }
                $audit['central_sale_id'] = $saleId;
            }

            Sql::run('UPDATE sync_conflicts SET resolution_status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?', [
                $resolution, $actor['id'], $now, $id,
            ]);
            Api::audit($actor, 'sync.conflict_resolved', 'sync_conflict', $id, $audit);

            return Api::ok('Sync conflict resolved.', $result);
        }, 3);
    }

    private function validRegisterReference(array $event): bool
    {
        return !isset($event['cashier_id']) || (
            $event['payload']['payment_method'] === 'cash'
            && $event['event_id'] === $event['payload']['sale_id']
            && Str::isUuid($event['payload']['sale_id'])
        );
    }

    private function registerReferenceMessage(): string
    {
        return 'Register-created offline events require a cash payment and matching sale references.';
    }
}
