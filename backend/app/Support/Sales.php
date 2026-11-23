<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Sales
{
    public const PAYMENT_RULE = 'sometimes|required|in:cash,gcash,bank_transfer';

    public const DEFAULT_TERMINAL = 'TERMINAL-001';

    public static function saleId(?string $reference = null): string
    {
        return 'sale-'.($reference ?? Str::uuid()->toString());
    }

    public static function saleNumber(string $id, string $prefix = 'SALE'): string
    {
        return $prefix.'-'.strtoupper(substr(str_replace('-', '', substr($id, 5)), 0, 16));
    }

    public static function withItems(array $sale): array
    {
        $sale['items'] = Sql::all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY '.Sql::rowSequence(), [$sale['id']]);

        return $sale;
    }

    public static function stockConflict(array $items): ?array
    {
        $required = [];
        foreach ($items as $item) {
            $id = $item['product_id'];
            $required[$id] = round(($required[$id] ?? 0) + $item['quantity_base'], 4);
            $balance = Sql::one('SELECT quantity_base FROM inventory_balances WHERE product_id = ?', [$id]);
            $available = (float) ($balance['quantity_base'] ?? 0);

            if ($balance === null || $required[$id] > $available + 0.0001) {
                return [
                    'product_id' => $id,
                    'product_name' => $item['product_name'],
                    'requested_base_qty' => $required[$id],
                    'available_base_qty' => $available,
                ];
            }
        }

        return null;
    }

    /** Records a sale, its payment and stock movements in the caller's transaction. */
    public static function record(
        array $sale,
        array $items,
        string $transactionType,
        string $now,
        ?string $syncEventId = null,
        ?string $orderNumber = null,
    ): array {
        DB::table('sales')->insert($sale);
        DB::table('payments')->insert([
            'id' => 'pay-'.$sale['id'],
            'transaction_type' => $transactionType,
            'transaction_id' => $sale['id'],
            'amount' => $sale['total'],
            'payment_method' => $sale['payment_method'],
            'reference' => $sale['sale_number'],
            'created_at' => $now,
        ]);

        foreach ($items as $item) {
            $line = [
                'id' => Api::id('si'),
                'sale_id' => $sale['id'],
                'product_id' => $item['product_id'],
                'product_name' => $item['product_name'],
                'sku' => $item['sku'],
                'quantity' => $item['quantity'],
                'unit_id' => $item['unit_id'],
                'unit_name' => $item['unit_name'],
                'conversion_factor' => $item['conversion_factor'],
                'quantity_base' => $item['quantity_base'],
                'unit_price' => $item['unit_price'],
                'line_total' => $item['line_total'],
            ];
            DB::table('sale_items')->insert($line);
            $note = match (true) {
                $syncEventId !== null => "Offline POS sync {$sale['sale_number']} ({$sale['terminal_id']})",
                $orderNumber !== null => "Fulfilled pre-order {$orderNumber}",
                default => "POS Sale {$sale['sale_number']} ({$line['quantity']} × {$line['unit_name']})",
            };
            self::moveStock(
                $line['product_id'],
                -(float) $line['quantity_base'],
                $syncEventId !== null ? 'sync_sale' : 'sale',
                $syncEventId !== null ? 'sync_event' : 'sale',
                $syncEventId ?? $sale['id'],
                $sale['cashier_id'],
                $note,
                $now,
            );
        }

        return self::withItems(Sql::one('SELECT * FROM sales WHERE id = ?', [$sale['id']]));
    }

    public static function moveStock(
        string $productId,
        float $quantity,
        string $movementType,
        string $referenceType,
        string $referenceId,
        string $actorId,
        string $notes,
        string $now,
    ): void {
        Sql::run('UPDATE inventory_balances SET quantity_base = ROUND(CAST(quantity_base + ? AS NUMERIC), 4) WHERE product_id = ?', [$quantity, $productId]);
        DB::table('inventory_movements')->insert([
            'id' => Api::id('mov'),
            'product_id' => $productId,
            'movement_type' => $movementType,
            'quantity_base' => $quantity,
            'reference_type' => $referenceType,
            'reference_id' => $referenceId,
            'created_by' => $actorId,
            'notes' => $notes,
            'created_at' => $now,
        ]);
    }
}
