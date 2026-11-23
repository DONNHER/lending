<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Catalog;
use App\Support\Sql;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

final class InventoryController
{
    private const WAREHOUSE = 'Main Cooperative Warehouse';

    public function search(Request $request): JsonResponse
    {
        $rawQuery = $request->query('q');
        $query = is_string($rawQuery) ? trim($rawQuery) : '';
        $perPage = min(30, max(1, (int) $request->query('per_page', 10)));
        if ($query === '') {
            return Api::fail('The submitted data is invalid.', 422, ['q' => ['Search query is required.']]);
        }

        $prefix = $query.'%';
        $rows = Sql::all(Catalog::SELECT_WITH_STOCK.' '.<<<'SQL'
            WHERE p.status = 'active'
              AND (p.barcode = ? OR lower(p.sku) LIKE lower(?) OR lower(p.name) LIKE lower(?))
            ORDER BY CASE WHEN p.barcode = ? THEN 0 WHEN lower(p.sku) LIKE lower(?) THEN 1 ELSE 2 END,
              p.name ASC
            LIMIT ?
            SQL, [$query, $prefix, '%'.$query.'%', $query, $prefix, $perPage]);

        return Api::ok('Products retrieved successfully.', Catalog::hydrate($rows), [
            'query' => $query,
            'limit' => $perPage,
            'count' => count($rows),
        ]);
    }

    public function index(): JsonResponse
    {
        return Api::ok('Products retrieved.', Catalog::hydrate(Sql::all(Catalog::SELECT_WITH_STOCK.' ORDER BY p.name ASC')));
    }

    public function show(string $id): JsonResponse
    {
        $row = $this->product($id);

        return $row === null
            ? Api::fail('Product not found.', 404)
            : Api::ok('Product retrieved successfully.', $row);
    }

    public function create(Request $request): JsonResponse
    {
        $input = $request->validate([
            'category_id' => ['required', 'string', 'exists:categories,id'],
            'sku' => ['required', 'string', 'min:2'],
            'barcode' => ['sometimes', 'nullable', 'string'],
            'name' => ['required', 'string', 'min:2'],
            'description' => ['required', 'string', 'min:2'],
            'base_unit' => ['sometimes', 'required', 'string'],
            'cost_price' => ['required', 'numeric', 'min:0'],
            'image_key' => ['sometimes', 'required', 'in:fertilizer,seeds,feed'],
            'initial_stock_base' => ['sometimes', 'required', 'numeric', 'min:0'],
            'units' => ['required', 'array', 'min:1'],
            'units.*.unit_name' => ['required', 'string'],
            'units.*.conversion_factor' => ['required', 'numeric', 'gt:0'],
            'units.*.selling_price' => ['required', 'numeric', 'min:0'],
            'units.*.is_default' => ['sometimes', 'required', 'boolean'],
        ]);
        $actor = Api::actor($request);
        $sku = strtoupper(trim($input['sku']));
        $barcode = $this->barcode($input['barcode'] ?? null);
        $id = Api::id('prod');
        $now = Api::now();

        try {
            return Sql::serialized(Sql::REGISTER_WRITES, function () use ($input, $actor, $sku, $barcode, $id, $now): JsonResponse {
                if (Sql::one('SELECT id FROM products WHERE lower(sku) = lower(?)', [$sku])) {
                    return Api::fail('The submitted data is invalid.', 422, ['sku' => ['SKU already exists.']]);
                }
                if ($barcode !== null && Sql::one('SELECT id FROM products WHERE barcode = ?', [$barcode])) {
                    return $this->duplicateBarcode();
                }

                $this->insertProduct($id, $sku, $barcode, $input, $now);
                foreach ($input['units'] as $unit) {
                    $this->insertUnit($id, $unit['unit_name'], (float) $unit['conversion_factor'],
                        (float) $unit['selling_price'], (bool) ($unit['is_default'] ?? false));
                }
                $stock = (float) ($input['initial_stock_base'] ?? 0);
                $this->insertBalance($id, $stock);
                if ($stock > 0) {
                    $this->movement($id, 'receipt', $stock, 'product_init', $id, $actor['id'], 'Opening balance on product creation', $now);
                }
                Api::audit($actor, 'product.created', 'product', $id, ['sku' => $input['sku']]);

                return Api::ok('Product created successfully.', $this->product($id), null, 201);
            });
        } catch (UniqueConstraintViolationException $error) {
            if ($barcode !== null && Sql::one('SELECT id FROM products WHERE barcode = ?', [$barcode])) {
                return $this->duplicateBarcode();
            }
            if (Sql::one('SELECT id FROM products WHERE lower(sku) = lower(?)', [$sku])) {
                return Api::fail('The submitted data is invalid.', 422, ['sku' => ['SKU already exists.']]);
            }
            throw $error;
        }
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $input = $request->validate([
            'category_id' => ['sometimes', 'required', 'string', 'exists:categories,id'],
            'barcode' => ['sometimes', 'nullable', 'string'],
            'name' => ['sometimes', 'required', 'string', 'min:2'],
            'description' => ['sometimes', 'required', 'string', 'min:2'],
            'cost_price' => ['sometimes', 'required', 'numeric', 'min:0'],
            'status' => ['sometimes', 'required', 'in:active,inactive'],
        ]);
        if (array_key_exists('barcode', $input)) {
            $input['barcode'] = $this->barcode($input['barcode']);
        }
        $barcode = $input['barcode'] ?? null;
        $actor = Api::actor($request);

        try {
            return Sql::serialized(Sql::REGISTER_WRITES, function () use ($id, $input, $barcode, $actor): JsonResponse {
                if (!Sql::one('SELECT id FROM products WHERE id = ?', [$id])) {
                    return Api::fail('Product not found.', 404);
                }
                if ($barcode !== null && Sql::one('SELECT id FROM products WHERE barcode = ? AND id <> ?', [$barcode, $id])) {
                    return $this->duplicateBarcode();
                }
                if ($input !== []) {
                    DB::table('products')->where('id', $id)->update($input);
                }
                Api::audit($actor, 'product.updated', 'product', $id, $input);

                return Api::ok('Product updated successfully.', $this->product($id));
            });
        } catch (UniqueConstraintViolationException $error) {
            if ($barcode !== null && Sql::one('SELECT id FROM products WHERE barcode = ? AND id <> ?', [$barcode, $id])) {
                return $this->duplicateBarcode();
            }
            throw $error;
        }
    }

    public function importLogs(): JsonResponse
    {
        $logs = Sql::all('SELECT * FROM import_logs ORDER BY created_at DESC LIMIT 30');
        foreach ($logs as &$log) {
            $log['failures'] = json_decode($log['failures_json'] ?? '[]', true) ?? [];
        }

        return Api::ok('Product import logs retrieved.', $logs);
    }

    public function import(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'filename' => ['required', 'string'],
            'format' => ['sometimes', 'required', 'string'],
            'duplicate_mode' => ['sometimes', 'required', 'in:skip,update'],
            'chunk_index' => ['sometimes', 'required', 'integer', 'min:0'],
            'total_chunks' => ['sometimes', 'required', 'integer', 'min:1'],
            'rows' => ['required', 'array', 'list', 'min:1', 'max:1000'],
            'rows.*' => ['array'],
        ]);
        if ($validator->fails()) {
            return Api::fail('Invalid import batch payload.', 422, $validator->errors()->toArray());
        }
        $batch = $validator->validated() + ['format' => 'xlsx', 'duplicate_mode' => 'skip', 'chunk_index' => 0, 'total_chunks' => 1];
        $categories = array_fill_keys(array_column(Sql::all('SELECT id FROM categories'), 'id'), true);
        $actor = Api::actor($request);
        $now = Api::now();

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($batch, $categories, $actor, $now): JsonResponse {
            $counts = ['created_count' => 0, 'updated_count' => 0, 'skipped_count' => 0, 'failed_count' => 0];
            $failures = [];
            foreach ($batch['rows'] as $index => $raw) {
                $rowNumber = is_numeric($raw['rowNumber'] ?? null) ? (int) $raw['rowNumber'] : $index + 2;
                $row = Validator::make($raw, [
                    'rowNumber' => ['required', 'integer', 'min:1'],
                    'sku' => ['required', 'string', 'min:2', 'max:64'],
                    'name' => ['required', 'string', 'max:255'],
                    'category_id' => ['required', 'string'],
                    'description' => ['required', 'string', 'min:2'],
                    'cost_price' => ['required', 'numeric', 'gt:0', 'max:999999.99'],
                    'stock_base' => ['required', 'numeric', 'min:0'],
                    'barcode' => ['nullable', 'string'],
                    'sack_factor' => ['sometimes', 'required', 'numeric', 'gt:0', 'max:1000'],
                    'sack_price' => ['sometimes', 'required', 'numeric', 'gt:0', 'max:999999.99'],
                    'kg_price' => ['sometimes', 'required', 'numeric', 'gt:0', 'max:999999.99'],
                    'image_key' => ['sometimes', 'required', 'in:fertilizer,seeds,feed'],
                ]);
                if ($row->fails()) {
                    $counts['failed_count']++;
                    $failures[] = [
                        'rowNumber' => $rowNumber,
                        'sku' => is_scalar($raw['sku'] ?? null) ? (string) $raw['sku'] : '—',
                        'name' => is_scalar($raw['name'] ?? null) ? (string) $raw['name'] : '—',
                        'reason' => $row->errors()->first(),
                    ];
                    continue;
                }

                $item = $row->validated() + ['sack_factor' => 50, 'image_key' => 'fertilizer'];
                $sku = strtoupper(trim($item['sku']));
                $barcode = $this->barcode($item['barcode'] ?? null);
                $existing = Sql::one('SELECT * FROM products WHERE lower(sku) = lower(?)', [$sku]);
                $owner = $barcode !== null ? Sql::one('SELECT id, sku FROM products WHERE barcode = ?', [$barcode]) : null;
                $reason = match (true) {
                    !isset($categories[$item['category_id']]) => 'Unknown category ID "'.$item['category_id'].'".',
                    $owner !== null && $owner['id'] !== ($existing['id'] ?? null) => "Barcode $barcode is already assigned to SKU {$owner['sku']}.",
                    default => null,
                };
                if ($reason !== null) {
                    $counts['failed_count']++;
                    $failures[] = ['rowNumber' => $rowNumber, 'sku' => $sku, 'name' => $item['name'], 'reason' => $reason];
                    continue;
                }
                if ($existing && $batch['duplicate_mode'] === 'skip') {
                    $counts['skipped_count']++;
                    continue;
                }

                $item['cost_price'] = round((float) $item['cost_price'], 2);
                $stock = round((float) $item['stock_base'], 4);
                if ($existing) {
                    $id = $existing['id'];
                    Sql::run('UPDATE products SET category_id = ?, barcode = ?, name = ?, description = ?, cost_price = ?, image_key = ? WHERE id = ?', [
                        $item['category_id'], $barcode ?? $existing['barcode'], trim($item['name']), trim($item['description']),
                        $item['cost_price'], $item['image_key'], $id,
                    ]);
                    Sql::run('UPDATE inventory_balances SET quantity_base = ? WHERE product_id = ?', [$stock, $id]);
                    $this->movement($id, 'adjustment_in', $stock, 'excel_import', $batch['filename'], $actor['id'], "Excel import update ({$batch['filename']})", $now);
                    $counts['updated_count']++;
                    continue;
                }

                $id = Api::id('prod');
                $kgPrice = $item['kg_price'] ?? round($item['cost_price'] * 1.25, 2);
                $sackPrice = $item['sack_price'] ?? round($kgPrice * $item['sack_factor'] * 0.94, 2);
                $this->insertProduct($id, $sku, $barcode, $item, $now);
                $this->insertUnit($id, "sack ({$item['sack_factor']} kg)", (float) $item['sack_factor'], (float) $sackPrice, true);
                $this->insertUnit($id, 'kg', 1, (float) $kgPrice, false);
                $this->insertBalance($id, $stock);
                if ($stock > 0) {
                    $this->movement($id, 'receipt', $stock, 'excel_import', $batch['filename'], $actor['id'], "Excel bulk import ({$batch['filename']})", $now);
                }
                $counts['created_count']++;
            }

            $id = Api::id('imp');
            $processed = $counts['created_count'] + $counts['updated_count'] + $counts['skipped_count'];
            $status = match (true) {
                $counts['failed_count'] === 0 => 'completed',
                $processed > 0 => 'completed_with_errors',
                default => 'failed',
            };
            DB::table('import_logs')->insert([
                'id' => $id, 'filename' => $batch['filename'], 'format' => $batch['format'],
                'duplicate_mode' => $batch['duplicate_mode'], 'total_rows' => count($batch['rows']), 'processed_rows' => $processed,
                ...$counts, 'failures_json' => json_encode($failures, JSON_THROW_ON_ERROR), 'status' => $status,
                'user_id' => $actor['id'], 'user_name' => $actor['name'], 'created_at' => $now,
            ]);
            Api::audit($actor, 'products.bulk_imported', 'import_log', $id, [
                'filename' => $batch['filename'], 'duplicate_mode' => $batch['duplicate_mode'], ...$counts,
                'chunk_index' => $batch['chunk_index'], 'total_chunks' => $batch['total_chunks'],
            ]);

            $chunk = $batch['chunk_index'] + 1;
            $message = "Import chunk $chunk/{$batch['total_chunks']} processed: {$counts['created_count']} created, {$counts['updated_count']} updated, {$counts['skipped_count']} skipped, {$counts['failed_count']} failed.";

            return Api::ok($message, ['import_log_id' => $id, ...$counts, 'failures' => $failures, 'status' => $status], null, 201);
        });
    }

    public function metadata(): JsonResponse
    {
        return Api::ok('Inventory metadata retrieved.', [
            'categories' => Sql::all('SELECT * FROM categories ORDER BY name ASC'),
            'suppliers' => Sql::all('SELECT * FROM suppliers ORDER BY name ASC'),
            'units' => Sql::all('SELECT * FROM units ORDER BY name ASC'),
            'locations' => Sql::all('SELECT * FROM inventory_locations ORDER BY name ASC'),
        ]);
    }

    public function balances(Request $request): JsonResponse
    {
        $hasPagination = $request->query->has('page') || $request->query->has('per_page');
        $total = (int) Sql::one('SELECT COUNT(*) AS count FROM products')['count'];
        $query = Catalog::SELECT_WITH_STOCK.' ORDER BY stock_base ASC, p.id ASC';
        if (!$hasPagination) {
            return Api::ok('Inventory balances retrieved.', Catalog::hydrate(Sql::all($query)), [
                'page' => 1, 'per_page' => $total ?: 1, 'total' => $total, 'total_pages' => 1, 'has_more' => false,
            ]);
        }

        $perPage = min(50, max(1, (int) $request->query('per_page', 8) ?: 8));
        $page = min(intdiv(PHP_INT_MAX, $perPage), max(1, (int) $request->query('page', 1)));
        $offset = ($page - 1) * $perPage;
        $rows = Sql::all($query.' LIMIT ? OFFSET ?', [$perPage, $offset]);

        return Api::ok('Inventory balances retrieved.', Catalog::hydrate($rows), [
            'page' => $page, 'per_page' => $perPage, 'total' => $total,
            'total_pages' => max(1, (int) ceil($total / $perPage)), 'has_more' => $offset + count($rows) < $total,
        ]);
    }

    public function movements(): JsonResponse
    {
        return Api::ok('Inventory movements retrieved.', Sql::all(<<<'SQL'
            SELECT m.*, p.name AS product_name, p.sku AS product_sku, p.base_unit, u.name AS created_by_name
            FROM inventory_movements m JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.created_by
            ORDER BY m.created_at DESC LIMIT 100
            SQL));
    }

    public function receive(Request $request): JsonResponse
    {
        $input = $request->validate([
            'supplier_id' => ['required', 'string', 'exists:suppliers,id'],
            'product_id' => ['required', 'string'],
            'unit_id' => ['required', 'string'],
            'quantity' => ['required', 'numeric', 'gt:0'],
            'notes' => ['nullable', 'string'],
        ]);
        $actor = Api::actor($request);
        $id = Api::id('rcpt');
        $receiptNumber = 'RCPT-'.strtoupper(substr($id, 5));
        $now = Api::now();

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($input, $actor, $id, $receiptNumber, $now): JsonResponse {
            $unit = Sql::one('SELECT * FROM product_units WHERE id = ? AND product_id = ?', [$input['unit_id'], $input['product_id']]);
            if (!$unit) {
                return Api::fail('Invalid product unit selected.', 404);
            }
            $quantityBase = round($input['quantity'] * $unit['conversion_factor'], 4);
            $affected = Sql::run('UPDATE inventory_balances SET quantity_base = ROUND(CAST(quantity_base + ? AS NUMERIC), 4) WHERE product_id = ?',
                [$quantityBase, $input['product_id']]);
            if ($affected === 0) {
                return Api::fail('Product balance not found.', 404);
            }
            Sql::run('INSERT INTO stock_receipts (id, supplier_id, received_by, receipt_number, created_at) VALUES (?, ?, ?, ?, ?)',
                [$id, $input['supplier_id'], $actor['id'], $receiptNumber, $now]);
            Sql::run('INSERT INTO stock_receipt_items (id, receipt_id, product_id, quantity, unit_id, conversion_factor) VALUES (?, ?, ?, ?, ?, ?)',
                [Api::id('ri'), $id, $input['product_id'], $input['quantity'], $input['unit_id'], $unit['conversion_factor']]);
            $notes = $input['notes'] ?? "Received {$input['quantity']} × {$unit['unit_name']}";
            $this->movement($input['product_id'], 'receipt', $quantityBase, 'stock_receipt', $id, $actor['id'], $notes, $now);
            Api::audit($actor, 'inventory.receipt_posted', 'stock_receipt', $id, [
                'product_id' => $input['product_id'], 'quantity_base' => $quantityBase,
            ]);

            return Api::ok("Stock receipt $receiptNumber posted (+$quantityBase base units).", [
                'receipt_id' => $id, 'receipt_number' => $receiptNumber, 'quantity_base' => $quantityBase,
            ], null, 201);
        });
    }

    public function adjust(Request $request): JsonResponse
    {
        $input = $request->validate([
            'product_id' => ['required', 'string'],
            'direction' => ['required', 'in:increase,decrease'],
            'quantity_base' => ['required', 'numeric', 'gt:0'],
            'notes' => ['required', 'string', 'min:3'],
        ]);
        $actor = Api::actor($request);
        $id = Api::id('adj');
        $now = Api::now();
        $isIncrease = $input['direction'] === 'increase';
        $delta = $input['quantity_base'] * ($isIncrease ? 1 : -1);

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($input, $actor, $id, $now, $isIncrease, $delta): JsonResponse {
            $productId = $input['product_id'];
            $affected = Sql::run(<<<'SQL'
                UPDATE inventory_balances SET quantity_base = ROUND(CAST(quantity_base + ? AS NUMERIC), 4)
                WHERE product_id = ? AND quantity_base + ? >= 0
                SQL, [$delta, $productId, $delta]);
            if ($affected === 0) {
                $balance = Sql::one('SELECT quantity_base FROM inventory_balances WHERE product_id = ?', [$productId]);
                if (!$balance) {
                    return Api::fail('Product balance not found.', 404);
                }

                return Api::fail('Adjustment would reduce stock below zero.', 422, [
                    'quantity_base' => ["Only {$balance['quantity_base']} base units available."],
                ]);
            }

            Sql::run('INSERT INTO inventory_adjustments (id, product_id, direction, quantity_base, created_by, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$id, $productId, $input['direction'], $input['quantity_base'], $actor['id'], trim($input['notes']), $now]);
            $this->movement($productId, $isIncrease ? 'adjustment_in' : 'adjustment_out', $delta, 'inventory_adjustment', $id, $actor['id'], trim($input['notes']), $now);
            Api::audit($actor, 'inventory.adjusted', 'product', $productId, ['delta' => $delta, 'notes' => $input['notes']]);

            return Api::ok('Auditable inventory adjustment recorded.', ['id' => $id, 'delta' => $delta], null, 201);
        });
    }

    private function product(string $id): ?array
    {
        return Catalog::hydrate(Sql::all(Catalog::SELECT_WITH_STOCK.' WHERE p.id = ?', [$id]))[0] ?? null;
    }

    private function barcode(?string $barcode): ?string
    {
        $value = trim($barcode ?? '');

        return $value === '' ? null : $value;
    }

    private function duplicateBarcode(): JsonResponse
    {
        return Api::fail('This barcode is already assigned to another product.', 409, [
            'barcode' => ['Scan a different barcode or generate a new one.'],
        ]);
    }

    private function insertProduct(string $id, string $sku, ?string $barcode, array $input, string $now): void
    {
        Sql::run(<<<'SQL'
            INSERT INTO products (id, category_id, sku, barcode, name, description, base_unit, cost_price, status, image_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            SQL, [$id, $input['category_id'], $sku, $barcode, trim($input['name']), trim($input['description']),
            $input['base_unit'] ?? 'kg', $input['cost_price'], $input['image_key'] ?? 'fertilizer', $now]);
    }

    private function insertUnit(string $id, string $name, float $factor, float $price, bool $default): void
    {
        Sql::run('INSERT INTO product_units (id, product_id, unit_name, conversion_factor, selling_price, is_default) VALUES (?, ?, ?, ?, ?, ?)',
            [Api::id('unit'), $id, $name, $factor, $price, (int) $default]);
    }

    private function insertBalance(string $id, float $stock): void
    {
        Sql::run('INSERT INTO inventory_balances (id, product_id, location_name, quantity_base) VALUES (?, ?, ?, ?)',
            ['bal-'.$id, $id, self::WAREHOUSE, $stock]);
    }

    private function movement(string $product, string $type, float $quantity, string $referenceType, string $reference, string $actor, string $notes, string $now): void
    {
        Sql::run(<<<'SQL'
            INSERT INTO inventory_movements (id, product_id, movement_type, quantity_base, reference_type, reference_id, created_by, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            SQL, [Api::id('mov'), $product, $type, $quantity, $referenceType, $reference, $actor, $notes, $now]);
    }
}
