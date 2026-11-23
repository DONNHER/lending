<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\Catalog;
use App\Support\Sales;
use App\Support\Sql;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

final class CommerceController
{
    private const ORDER_SELECT = "
        SELECT o.*, sp.first_name || ' ' || sp.last_name AS shareholder_name, sp.membership_number
        FROM orders o JOIN shareholder_profiles sp ON sp.id = o.shareholder_id
    ";

    private const CART_RULES = [
        'items' => 'required|array|list|min:1',
        'items.*.product_id' => 'required|string',
        'items.*.unit_id' => 'required|string',
        'items.*.quantity' => 'required|numeric|gt:0',
    ];

    private const TENDER_RULES = [
        'terminal_id' => 'sometimes|required|string',
        'payment_method' => Sales::PAYMENT_RULE,
    ];

    public function catalog(Request $request): JsonResponse
    {
        $category = trim(is_string($request->query('category')) ? $request->query('category') : '');
        $search = trim(is_string($request->query('q')) ? $request->query('q') : '');
        $page = max(1, $request->integer('page', 1));
        $perPage = min(50, max(1, $request->integer('per_page', 12)));
        $pagination = $request->hasAny(['page', 'per_page']);

        $conditions = ["p.status = 'active'"];
        $bindings = [];
        if ($category !== '' && strtolower($category) !== 'all') {
            $conditions[] = 'c.name = ?';
            $bindings[] = $category;
        }
        if ($search !== '') {
            $conditions[] = '(lower(p.name) LIKE lower(?) OR lower(p.sku) LIKE lower(?) OR p.barcode = ? OR lower(c.name) LIKE lower(?) OR lower(p.description) LIKE lower(?))';
            array_push($bindings, "%{$search}%", "{$search}%", $search, "%{$search}%", "%{$search}%");
        }

        $where = implode(' AND ', $conditions);
        $total = (int) Sql::one("SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE {$where}", $bindings)['total'];
        $categories = array_column(Sql::all("
            SELECT DISTINCT c.name FROM products p JOIN categories c ON c.id = p.category_id
            WHERE p.status = 'active' ORDER BY c.name
        "), 'name');
        $sort = $request->query('sort');
        $price = '(SELECT u.selling_price FROM product_units u WHERE u.product_id = p.id
            ORDER BY u.is_default DESC, u.conversion_factor DESC, u.id ASC LIMIT 1)';
        $order = match ($sort) {
            'newest' => 'p.created_at DESC, ',
            'oldest' => 'p.created_at ASC, ',
            'price_asc' => "$price ASC NULLS LAST, ",
            'price_desc' => "$price DESC NULLS LAST, ",
            default => '',
        };
        $query = Catalog::SELECT_WITH_STOCK." WHERE {$where} ORDER BY {$order}p.name, p.id";
        $offset = $pagination ? ($page - 1) * $perPage : 0;
        if ($pagination) {
            $query .= ' LIMIT ? OFFSET ?';
            array_push($bindings, $perPage, $offset);
        }
        $rows = Sql::all($query, $bindings);

        return Api::ok('Storefront catalog retrieved.', Catalog::hydrate($rows), [
            'page' => $pagination ? $page : 1,
            'per_page' => $pagination ? $perPage : max(1, $total),
            'total' => $total,
            'total_pages' => $pagination ? max(1, (int) ceil($total / $perPage)) : 1,
            'has_more' => $pagination && $offset + count($rows) < $total,
            'categories' => $categories,
        ]);
    }

    public function createOrder(Request $request): JsonResponse
    {
        $actor = Api::actor($request);
        $shareholder = Sql::one('SELECT id FROM shareholder_profiles WHERE user_id = ?', [$actor['id']]);
        if ($shareholder === null) {
            return Api::fail('Only shareholder accounts can place online pre-orders.', 403);
        }

        $data = $request->validate(self::CART_RULES + [
            'notes' => 'nullable|string',
            'status' => 'sometimes|required|in:draft,confirmed',
        ], ['items.required' => 'Cart cannot be empty.', 'items.min' => 'Cart cannot be empty.']);

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($data, $actor, $shareholder): JsonResponse {
            $items = $this->resolveCart($data['items'], true);
            $this->checkStock($items, 'Insufficient warehouse stock for');
            $id = 'ord-'.bin2hex(random_bytes(8));
            $number = 'ORD-'.gmdate('Y').'-'.strtoupper(substr($id, 4));
            $token = 'ARG-ORD-'.strtoupper(bin2hex(random_bytes(5)));
            $expires = $this->expiry();
            $status = $data['status'] ?? 'confirmed';
            DB::table('orders')->insert([
                'id' => $id,
                'order_number' => $number,
                'shareholder_id' => $shareholder['id'],
                'status' => $status,
                'total' => round(array_sum(array_column($items, 'line_total')), 2),
                'token_code' => $token,
                'token_expires_at' => $expires,
                'notes' => $data['notes'] ?? null,
                'created_at' => Api::now(),
            ]);
            $this->storeToken($id, $token, $expires);
            foreach ($items as $item) {
                unset($item['quantity_base']);
                DB::table('order_items')->insert([
                    'id' => Api::id('oi'),
                    'order_id' => $id,
                ] + $item);
            }
            Api::audit($actor, 'order.created', 'order', $id, [
                'order_number' => $number,
                'token_code' => $token,
                'status' => $status,
            ]);
            $message = $status === 'confirmed'
                ? "Pre-order {$number} confirmed. Present token {$token} at POS."
                : "Draft pre-order {$number} saved.";

            return Api::ok($message, $this->withOrderItems(Sql::one('SELECT * FROM orders WHERE id = ?', [$id])), null, 201);
        }, 3);
    }

    public function myOrders(Request $request): JsonResponse
    {
        $actor = Api::actor($request);
        $shareholder = Sql::one('SELECT id FROM shareholder_profiles WHERE user_id = ?', [$actor['id']]);
        if ($shareholder === null) {
            return Api::ok('No shareholder orders.', []);
        }
        $orders = Sql::all('SELECT * FROM orders WHERE shareholder_id = ? ORDER BY created_at DESC', [$shareholder['id']]);

        return Api::ok('Shareholder orders retrieved.', array_map([$this, 'withOrderItems'], $orders));
    }

    public function orders(): JsonResponse
    {
        $orders = Sql::all(self::ORDER_SELECT.' ORDER BY o.created_at DESC');

        return Api::ok('All cooperative pre-orders retrieved.', array_map([$this, 'withOrderItems'], $orders));
    }

    public function showOrder(Request $request, string $id): JsonResponse
    {
        $order = $this->authorizedOrder($request, $id, 'view', ['admin', 'manager', 'cashier']);

        return Api::ok('Order retrieved successfully.', $this->withOrderItems($order));
    }

    public function confirmOrder(Request $request, string $id): JsonResponse
    {
        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($request, $id): JsonResponse {
            $order = $this->authorizedOrder($request, $id, 'confirm', ['admin', 'manager']);
            if (in_array($order['status'], ['fulfilled', 'cancelled'], true)) {
                return Api::fail("Order in status '{$order['status']}' cannot be confirmed.", 409);
            }

            $this->checkStock($this->orderSaleItems($id), 'Insufficient warehouse stock for');
            $expires = $this->expiry();
            Sql::run("UPDATE orders SET status = 'confirmed', token_expires_at = ? WHERE id = ?", [$expires, $id]);
            $this->storeToken($id, $order['token_code'], $expires);
            Api::audit(Api::actor($request), 'order.confirmed', 'order', $id, ['token_code' => $order['token_code']]);

            return Api::ok("Order {$order['order_number']} confirmed with token {$order['token_code']}.", [
                'id' => $id,
                'status' => 'confirmed',
                'token_code' => $order['token_code'],
                'token_expires_at' => $expires,
            ]);
        }, 3);
    }

    public function cancelOrder(Request $request, string $id): JsonResponse
    {
        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($request, $id): JsonResponse {
            $order = $this->authorizedOrder($request, $id, 'cancel', ['admin', 'manager']);
            if ($order['status'] === 'fulfilled') {
                return Api::fail('Fulfilled orders cannot be cancelled.', 400);
            }

            Sql::run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [$id]);
            Api::audit(Api::actor($request), 'order.cancelled', 'order', $id);

            return Api::ok('Pre-order cancelled.', ['id' => $id, 'status' => 'cancelled']);
        }, 3);
    }

    public function scanOrder(string $token): JsonResponse
    {
        $token = strtoupper(trim($token));
        $order = Sql::one(self::ORDER_SELECT.' WHERE upper(o.token_code) = ? OR upper(o.order_number) = ?', [$token, $token]);
        if ($order === null) {
            return Api::fail('No pre-order matches that token or order number.', 404);
        }
        if ($order['status'] === 'fulfilled' || $order['token_used_at']) {
            return Api::fail('This pre-order token has already been fulfilled.', 409);
        }
        if ($order['status'] === 'cancelled') {
            return Api::fail('This pre-order was cancelled.', 400);
        }

        return Api::ok('Pre-order retrieved for POS fulfillment.', $this->withOrderItems($order));
    }

    public function fulfillOrder(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), self::TENDER_RULES);
        if ($validator->fails()) {
            return Api::fail('Invalid fulfillment payload.', 422);
        }
        $data = $validator->validated();
        $actor = Api::actor($request);

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($id, $data, $actor): JsonResponse {
            $order = Sql::one('SELECT * FROM orders WHERE id = ?', [$id]);
            if ($order === null) {
                return Api::fail('Pre-order not found.', 404);
            }
            if ($order['status'] !== 'confirmed' || $order['token_used_at']) {
                return Api::fail('Order cannot be fulfilled in its current state.', 409);
            }

            $items = $this->orderSaleItems($id);
            $this->checkStock($items, 'Insufficient stock for');
            $now = Api::now();
            $saleId = Sales::saleId();
            $number = Sales::saleNumber($saleId);
            $sale = Sales::record([
                'id' => $saleId,
                'sale_number' => $number,
                'cashier_id' => $actor['id'],
                'terminal_id' => $data['terminal_id'] ?? Sales::DEFAULT_TERMINAL,
                'order_id' => $id,
                'shareholder_id' => $order['shareholder_id'],
                'total' => $order['total'],
                'payment_method' => $data['payment_method'] ?? 'cash',
                'status' => 'completed',
                'source' => 'preorder_fulfillment',
                'created_at' => $now,
            ], $items, 'order_fulfillment', $now, orderNumber: $order['order_number']);
            Sql::run("UPDATE orders SET status = 'fulfilled', token_used_at = ? WHERE id = ?", [$now, $id]);
            Sql::run('UPDATE order_tokens SET used_at = ? WHERE order_id = ?', [$now, $id]);
            Api::audit($actor, 'pos.order_fulfilled', 'sale', $saleId, [
                'order_number' => $order['order_number'],
                'sale_number' => $number,
            ]);

            return Api::ok("Pre-order fulfilled as POS sale {$number}.", $sale, null, 201);
        }, 3);
    }

    public function checkout(Request $request): JsonResponse
    {
        $data = $request->validate(self::CART_RULES + self::TENDER_RULES + [
            'client_sale_id' => 'sometimes|required|uuid',
            'shareholder_id' => 'nullable|string',
        ], ['items.required' => 'POS cart cannot be empty.', 'items.min' => 'POS cart cannot be empty.']);
        $actor = Api::actor($request);
        $terminal = $data['terminal_id'] ?? Sales::DEFAULT_TERMINAL;
        $saleId = Sales::saleId($data['client_sale_id'] ?? null);

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($data, $actor, $terminal, $saleId): JsonResponse {
            if (isset($data['client_sale_id'])) {
                $existing = Sql::one('SELECT * FROM sales WHERE id = ?', [$saleId]);
                if ($existing !== null) {
                    if ($existing['cashier_id'] !== $actor['id'] || $existing['terminal_id'] !== $terminal) {
                        return Api::fail('This sale reference already belongs to another register session.', 409);
                    }

                    return Api::ok('This sale was already recorded.', Sales::withItems($existing));
                }
            }
            if (!empty($data['shareholder_id'])
                && Sql::one('SELECT id FROM shareholder_profiles WHERE id = ?', [$data['shareholder_id']]) === null) {
                return Api::fail('Shareholder not found.', 404);
            }
            $items = $this->resolveCart($data['items'], false);
            $this->checkStock($items, 'Insufficient stock for');
            $now = Api::now();
            $number = Sales::saleNumber($saleId);
            $total = round(array_sum(array_column($items, 'line_total')), 2);
            $sale = Sales::record([
                'id' => $saleId,
                'sale_number' => $number,
                'cashier_id' => $actor['id'],
                'terminal_id' => $terminal,
                'shareholder_id' => $data['shareholder_id'] ?? null,
                'total' => $total,
                'payment_method' => $data['payment_method'] ?? 'cash',
                'status' => 'completed',
                'source' => 'online_pos',
                'created_at' => $now,
            ], $items, 'pos_sale', $now);
            Api::audit($actor, 'pos.sale_completed', 'sale', $saleId, ['sale_number' => $number, 'total' => $total]);

            return Api::ok("Sale {$number} completed.", $sale, null, 201);
        }, 3);
    }

    public function sales(): JsonResponse
    {
        $sales = Sql::all('
            SELECT s.*, u.name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id
            ORDER BY s.created_at DESC LIMIT 40
        ');

        return Api::ok('Sales retrieved.', array_map([Sales::class, 'withItems'], $sales));
    }

    public function returnSale(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'sale_id' => 'required|string',
            'reason' => 'required|string|min:3',
            'items' => 'required|array|list|min:1',
            'items.*.sale_item_id' => 'required|string',
            'items.*.quantity' => 'required|numeric|gt:0',
        ]);
        if ($validator->fails()) {
            return Api::fail('Invalid return request.', 422, $validator->errors()->toArray());
        }
        $data = $validator->validated();
        $actor = Api::actor($request);

        return Sql::serialized(Sql::REGISTER_WRITES, function () use ($data, $actor): JsonResponse {
            $sale = Sql::one('SELECT * FROM sales WHERE id = ?', [$data['sale_id']]);
            if ($sale === null) {
                return Api::fail('Original sale not found.', 404);
            }
            if ($sale['status'] === 'returned') {
                return Api::fail('This sale has already been fully returned.');
            }

            $lines = [];
            $requested = [];
            foreach ($data['items'] as $line) {
                $item = Sql::one('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', [$line['sale_item_id'], $sale['id']]);
                if ($item === null) {
                    return Api::fail('Sale item not found.', 404);
                }
                $quantity = (float) $line['quantity'];
                $requested[$item['id']] = ($requested[$item['id']] ?? 0) + $quantity;
                $previous = Sql::one('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM return_items WHERE sale_item_id = ?', [$item['id']]);
                if ($requested[$item['id']] + $previous['quantity'] > $item['quantity'] + 0.0001) {
                    return Api::fail('Return quantity exceeds original sold quantity.', 422);
                }
                $lines[] = [
                    'sale_item_id' => $item['id'],
                    'product_id' => $item['product_id'],
                    'quantity' => $quantity,
                    'quantity_base' => round($quantity * $item['conversion_factor'], 4),
                    'refund_amount' => round($quantity * $item['unit_price'], 2),
                ];
            }

            $total = round(array_sum(array_column($lines, 'refund_amount')), 2);
            $returnId = Api::id('ret');
            $now = Api::now();
            DB::table('returns')->insert([
                'id' => $returnId,
                'sale_id' => $sale['id'],
                'processed_by' => $actor['id'],
                'reason' => trim($data['reason']),
                'total' => $total,
                'created_at' => $now,
            ]);
            foreach ($lines as $line) {
                DB::table('return_items')->insert([
                    'id' => Api::id('reti'),
                    'return_id' => $returnId,
                    'sale_item_id' => $line['sale_item_id'],
                    'quantity' => $line['quantity'],
                    'refund_amount' => $line['refund_amount'],
                ]);
                Sales::moveStock(
                    $line['product_id'], $line['quantity_base'], 'return', 'return', $returnId,
                    $actor['id'], "Return from {$sale['sale_number']}: {$data['reason']}", $now,
                );
            }
            Sql::run("UPDATE sales SET status = 'returned' WHERE id = ?", [$sale['id']]);
            Api::audit($actor, 'pos.return_processed', 'return', $returnId, [
                'sale_number' => $sale['sale_number'],
                'refund_total' => $total,
            ]);
            $formatted = number_format($total, 2, '.', '');

            return Api::ok("Return processed. Refunded PHP {$formatted}.", ['id' => $returnId, 'refund_total' => $total], null, 201);
        }, 3);
    }

    private function resolveCart(array $cart, bool $onlineOrder): array
    {
        $items = [];
        foreach ($cart as $line) {
            $product = Sql::one(
                "SELECT p.id, p.name, p.sku, u.id AS unit_id, u.unit_name, u.conversion_factor, u.selling_price
                FROM products p JOIN product_units u ON u.product_id = p.id
                JOIN inventory_balances b ON b.product_id = p.id
                WHERE p.id = ? AND u.id = ? AND p.status = 'active'",
                [$line['product_id'], $line['unit_id']],
            );
            if ($product === null) {
                $message = $onlineOrder ? 'One or more products in cart are unavailable.' : 'Product or selling unit not found.';
                throw new HttpResponseException(Api::fail($message, 404));
            }

            $quantity = (float) $line['quantity'];
            $conversion = (float) $product['conversion_factor'];
            $unitPrice = (float) $product['selling_price'];
            $quantityBase = round($quantity * $conversion, 4);
            if ($quantityBase <= 0) {
                throw new HttpResponseException(Api::fail('Quantity is too small for the selling unit.', 422));
            }
            $items[] = [
                'product_id' => $product['id'],
                'product_name' => $product['name'],
                'sku' => $product['sku'],
                'quantity' => $quantity,
                'unit_id' => $product['unit_id'],
                'unit_name' => $product['unit_name'],
                'conversion_factor' => $conversion,
                'quantity_base' => $quantityBase,
                'unit_price' => $unitPrice,
                'line_total' => round($quantity * $unitPrice, 2),
            ];
        }

        return $items;
    }

    private function checkStock(array $items, string $messagePrefix): void
    {
        $conflict = Sales::stockConflict($items);
        if ($conflict !== null) {
            $name = $conflict['product_name'];
            throw new HttpResponseException(Api::fail("{$messagePrefix} {$name}.", 422, [
                'items' => [
                    "Requested {$conflict['requested_base_qty']} base units of {$name}, only {$conflict['available_base_qty']} available.",
                ],
            ]));
        }
    }

    private function withOrderItems(array $order): array
    {
        $order['items'] = Sql::all('SELECT * FROM order_items WHERE order_id = ? ORDER BY '.Sql::rowSequence(), [$order['id']]);

        return $order;
    }

    private function orderSaleItems(string $id): array
    {
        $items = Sql::all('SELECT * FROM order_items WHERE order_id = ? ORDER BY '.Sql::rowSequence(), [$id]);
        foreach ($items as &$item) {
            $item['quantity_base'] = round($item['quantity'] * $item['conversion_factor'], 4);
        }

        return $items;
    }

    private function authorizedOrder(Request $request, string $id, string $action, array $staff): array
    {
        $actor = Api::actor($request);
        $order = Sql::one(self::ORDER_SELECT.' WHERE o.id = ?', [$id]);
        if ($order === null) {
            throw new HttpResponseException(Api::fail('Order not found.', 404));
        }
        $owner = Sql::one('SELECT user_id FROM shareholder_profiles WHERE id = ?', [$order['shareholder_id']]);
        if (!in_array($actor['role'], $staff, true) && $owner['user_id'] !== $actor['id']) {
            throw new HttpResponseException(Api::fail("You do not have permission to {$action} this order.", 403));
        }

        return $order;
    }

    private function expiry(): string
    {
        return now('UTC')->addDays(7)->format('Y-m-d\TH:i:s.v\Z');
    }

    private function storeToken(string $id, string $token, string $expires): void
    {
        Sql::run('
            INSERT INTO order_tokens (id, order_id, token_hash, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)
            ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at
        ', ['otok-'.$id, $id, hash('sha256', strtoupper(trim($token))), $expires]);
    }
}
