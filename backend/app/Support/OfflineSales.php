<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

final class OfflineSales
{
    public static function process(array $actor, string $terminal, array $events, ?string $device): array
    {
        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($actor, $terminal, $events, $device): array {
            $batch = Api::id('batch');
            $now = Api::now();
            DB::table('sync_batches')->insert([
                'id' => $batch,
                'terminal_id' => $terminal,
                'received_count' => count($events),
                'processed_count' => 0,
                'duplicate_count' => 0,
                'conflict_count' => 0,
                'created_at' => $now,
            ]);

            $results = [];
            $counts = ['processed' => 0, 'duplicate_ignored' => 0, 'conflict' => 0, 'rejected' => 0];
            foreach ($events as $event) {
                $result = self::processEvent($actor, $batch, $event, $now);
                $results[] = $result;
                $counts[$result['status']]++;
            }

            $summary = [
                'processed_count' => $counts['processed'],
                'duplicate_count' => $counts['duplicate_ignored'],
                'conflict_count' => $counts['conflict'],
            ];
            DB::table('sync_batches')->where('id', $batch)->update($summary);
            DB::table('pos_terminals')->where('terminal_code', $terminal)->update(['last_sync_at' => $now]);
            self::saveCursor($terminal, $device ?: 'DEV-'.$terminal, $now, true);
            Api::audit($actor, 'sync.batch_processed', 'sync_batch', $batch, [
                'processedCount' => $counts['processed'],
                'duplicateCount' => $counts['duplicate_ignored'],
                'conflictCount' => $counts['conflict'],
            ]);

            return ['batch_id' => $batch, 'sync_cursor' => $now, 'results' => $results] + $summary;
        }, 3);
    }

    private static function processEvent(array $actor, string $batch, array $event, string $now): array
    {
        $eventId = $event['event_id'];
        $terminal = $event['terminal_id'];
        $payload = $event['payload'];
        $stableId = isset($event['cashier_id']) ? Sales::saleId($payload['sale_id']) : null;
        if ($stableId !== null) {
            // Online checkout and its offline retry share this ID when a reply is lost.
            $existing = Sql::one('SELECT cashier_id, terminal_id FROM sales WHERE id = ?', [$stableId]);
            if ($existing !== null) {
                return $existing['cashier_id'] === $actor['id'] && $existing['terminal_id'] === $terminal
                    ? ['event_id' => $eventId, 'status' => 'duplicate_ignored', 'central_sale_id' => $stableId]
                    : ['event_id' => $eventId, 'status' => 'rejected', 'reason' => 'Sale reference is in use.'];
            }
        }

        $previous = Sql::one('SELECT terminal_id, central_sale_id, status, conflict_reason FROM sync_events WHERE event_id = ?', [$eventId]);
        if ($previous !== null) {
            if ($previous['terminal_id'] !== $terminal) {
                return ['event_id' => $eventId, 'status' => 'rejected', 'reason' => 'Event reference is in use.'];
            }

            return $previous['status'] === 'conflict'
                ? ['event_id' => $eventId, 'status' => 'conflict', 'reason' => $previous['conflict_reason']]
                : ['event_id' => $eventId, 'status' => 'duplicate_ignored', 'central_sale_id' => $previous['central_sale_id']];
        }

        $eventRow = [
            'id' => Api::id('se'),
            'event_id' => $eventId,
            'batch_id' => $batch,
            'terminal_id' => $terminal,
            'event_type' => $event['event_type'],
            'payload_json' => json_encode($event, JSON_THROW_ON_ERROR),
            'created_at' => $now,
        ];
        $conflict = Sales::stockConflict($payload['items']);
        if ($conflict !== null) {
            $reason = "Insufficient central stock for {$conflict['product_name']}: needed {$conflict['requested_base_qty']} base units, available {$conflict['available_base_qty']}.";
            DB::table('sync_events')->insert($eventRow + ['status' => 'conflict', 'conflict_reason' => $reason]);
            DB::table('sync_conflicts')->insert($conflict + [
                'id' => Api::id('conf'),
                'event_id' => $eventId,
                'terminal_id' => $terminal,
                'reason' => $reason,
                'resolution_status' => 'open',
                'created_at' => $now,
            ]);

            return ['event_id' => $eventId, 'status' => 'conflict', 'reason' => $reason];
        }

        $saleId = self::postSale($event, $actor['id'], $now, $stableId);
        DB::table('sync_events')->insert($eventRow + ['status' => 'processed', 'central_sale_id' => $saleId]);

        return ['event_id' => $eventId, 'status' => 'processed', 'central_sale_id' => $saleId];
    }

    /** Post or link a saved conflict event while the caller holds the resolution transaction. */
    public static function acceptConflict(array $saved, array $event, string $now): string
    {
        // Older devices did not send a cashier ID. Their batch audit identifies the authenticated submitter.
        $cashierId = $event['cashier_id'] ?? $saved['batch_actor_id'];
        if ($cashierId === null || Sql::one('SELECT id FROM users WHERE id = ?', [$cashierId]) === null) {
            throw new ConflictHttpException('The original cashier could not be identified. This conflict remains open for review.');
        }

        $stableId = isset($event['cashier_id']) ? Sales::saleId($event['payload']['sale_id']) : null;
        $saleId = $saved['central_sale_id'] ?? $stableId;
        $existing = $saleId === null ? null : Sql::one('SELECT cashier_id, terminal_id FROM sales WHERE id = ?', [$saleId]);
        if ($existing !== null && ($existing['cashier_id'] !== $cashierId || $existing['terminal_id'] !== $event['terminal_id'])) {
            throw new ConflictHttpException('The saved sale reference belongs to another cashier or terminal.');
        }
        if ($existing === null) {
            if ($saved['status'] !== 'conflict') {
                throw new ConflictHttpException('The posted sale for this event could not be found.');
            }
            foreach (array_unique(array_column($event['payload']['items'], 'product_id')) as $productId) {
                if (Sql::one('SELECT product_id FROM inventory_balances WHERE product_id = ?', [$productId]) === null) {
                    throw new ConflictHttpException('An item in the saved sale no longer has an inventory balance. Restore it before reconciling.');
                }
            }
            $saleId = self::postSale($event, $cashierId, $now, $stableId);
        }

        if ($saved['status'] !== 'processed' || $saved['central_sale_id'] !== $saleId) {
            DB::table('sync_events')->where('id', $saved['id'])->update(['status' => 'processed', 'central_sale_id' => $saleId]);
        }

        return $saleId;
    }

    private static function postSale(array $event, string $cashierId, string $now, ?string $stableId): string
    {
        $payload = $event['payload'];
        $saleId = $stableId ?? Sales::saleId();
        Sales::record([
            'id' => $saleId,
            'sale_number' => Sales::saleNumber($saleId, $stableId !== null ? 'SALE' : 'SYNC'),
            'cashier_id' => $cashierId,
            'terminal_id' => $event['terminal_id'],
            'total' => $payload['total'],
            'payment_method' => $payload['payment_method'],
            'status' => 'completed',
            'source' => 'offline_sync',
            'created_at' => $event['occurred_at'],
        ], $payload['items'], 'offline_sync', $now, syncEventId: $event['event_id']);

        return $saleId;
    }

    public static function changes(?string $cursor, ?string $terminal, ?string $device): array
    {
        $since = $cursor ?: '1970-01-01T00:00:00.000Z';
        $nextCursor = Api::now();
        $products = Sql::all('
            SELECT DISTINCT p.*, c.name AS category_name, COALESCE(ib.quantity_base, 0) AS stock_base
            FROM products p JOIN categories c ON c.id = p.category_id
            LEFT JOIN inventory_balances ib ON ib.product_id = p.id
            WHERE (p.created_at > ? AND p.created_at <= ?)
                OR EXISTS (SELECT 1 FROM inventory_movements m
                    WHERE m.product_id = p.id AND m.created_at > ? AND m.created_at <= ?)
            ORDER BY p.name
        ', [$since, $nextCursor, $since, $nextCursor]);
        $movements = Sql::all('
            SELECT id, product_id, movement_type, quantity_base, reference_type, reference_id, created_at
            FROM inventory_movements WHERE created_at > ? AND created_at <= ?
            ORDER BY created_at LIMIT 200
        ', [$since, $nextCursor]);
        $orders = Sql::all('
            SELECT id, order_number, status, token_code, total, token_used_at, created_at
            FROM orders WHERE (created_at > ? AND created_at <= ?) OR (token_used_at > ? AND token_used_at <= ?)
            ORDER BY created_at DESC LIMIT 100
        ', [$since, $nextCursor, $since, $nextCursor]);
        if ($device || $terminal) {
            self::saveCursor($terminal ?: Sales::DEFAULT_TERMINAL, $device ?: 'DEV-'.$terminal, $nextCursor, false);
        }

        return [
            'cursor_used' => $since,
            'next_cursor' => $nextCursor,
            'products' => Catalog::hydrate($products),
            'inventory_movements' => $movements,
            'orders' => $orders,
        ];
    }

    private static function saveCursor(string $terminal, string $device, string $cursor, bool $updateTerminal): void
    {
        $updates = ['last_cursor', 'last_sync_at', 'updated_at'];
        if ($updateTerminal) {
            $updates[] = 'terminal_id';
        }
        DB::table('device_sync_states')->upsert([[
            'id' => Api::id('dss'),
            'terminal_id' => $terminal,
            'device_identifier' => $device,
            'last_cursor' => $cursor,
            'last_sync_at' => $cursor,
            'updated_at' => $cursor,
        ]], ['device_identifier'], $updates);
    }
}
