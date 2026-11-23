<?php

namespace App\Support;

final class Catalog
{
    public const SELECT_WITH_STOCK = <<<'SQL'
        SELECT p.*, c.name AS category_name, COALESCE(ib.quantity_base, 0) AS stock_base
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN inventory_balances ib ON ib.product_id = p.id
        SQL;

    public static function hydrate(array $rows): array
    {
        $unitsByProduct = [];
        foreach (array_chunk(array_unique(array_column($rows, 'id')), 500) as $ids) {
            $placeholders = implode(', ', array_fill(0, count($ids), '?'));
            $units = Sql::all(
                "SELECT id, product_id, unit_name, conversion_factor, selling_price, is_default
                FROM product_units WHERE product_id IN ($placeholders) ORDER BY conversion_factor DESC, id ASC",
                array_values($ids)
            );
            foreach ($units as $unit) {
                $unitsByProduct[$unit['product_id']][] = [
                    ...$unit,
                    'conversion_factor' => (float) $unit['conversion_factor'],
                    'selling_price' => (float) $unit['selling_price'],
                    'is_default' => (bool) $unit['is_default'],
                ];
            }
        }

        return array_map(static function (array $row) use ($unitsByProduct): array {
            return [
                'id' => $row['id'],
                'category_id' => $row['category_id'],
                ...(!empty($row['category_name']) ? ['category_name' => $row['category_name']] : []),
                'sku' => $row['sku'],
                'barcode' => isset($row['barcode']) && $row['barcode'] !== '' ? (string) $row['barcode'] : null,
                'name' => $row['name'],
                'description' => $row['description'],
                'base_unit' => $row['base_unit'],
                'cost_price' => (float) $row['cost_price'],
                'status' => $row['status'],
                'image_url' => $row['image_key'] ?: 'fertilizer',
                'stock_base' => (float) ($row['stock_base'] ?? 0),
                'units' => $unitsByProduct[$row['id']] ?? [],
            ];
        }, $rows);
    }
}
