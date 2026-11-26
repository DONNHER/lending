<?php

namespace Database\Seeders;

use App\Support\Api;
use App\Support\Sql;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class BulfaAgrivetCatalogSeeder extends Seeder
{
    public function run(): void
    {
        // Agrivet_Data.docx, Bulfa Agrivet price list dated 2026-11-20.
        $catalog = json_decode(file_get_contents(__DIR__.'/bulfa-agrivet-price-list.json'), true, flags: JSON_THROW_ON_ERROR);

        $inserted = Sql::serialized(Sql::REGISTER_WRITES, function () use ($catalog): int {
            $count = 0;
            $created = Api::now();
            foreach ($catalog as $group) {
                DB::table('categories')->insertOrIgnore(['id' => $group['category_id'], 'name' => $group['category_name']]);
                foreach ($group['items'] as $index => $item) {
                    $number = str_pad((string) ($index + 1), 3, '0', STR_PAD_LEFT);
                    $sku = 'BLF-'.$group['code'].'-'.$number;
                    $key = strtolower($sku);
                    $id = 'prod-'.$key;
                    if (DB::table('products')->where('id', $id)->exists()) {
                        continue;
                    }

                    DB::table('products')->insert([
                        'id' => $id, 'category_id' => $group['category_id'], 'sku' => $sku,
                        'barcode' => $sku, 'name' => $item['name'], 'description' => $item['description'] ?? '',
                        'base_unit' => 'pack', 'cost_price' => 0, 'image_key' => $group['image_key'], 'created_at' => $created,
                    ]);
                    DB::table('product_units')->insert([
                        'id' => 'unit-'.$key, 'product_id' => $id, 'unit_name' => $item['unit'], 'conversion_factor' => 1,
                        'selling_price' => $item['selling_price'], 'is_default' => 1,
                    ]);
                    // The price list gives no counts or costs. Track one stock unit per sellable package.
                    DB::table('inventory_balances')->insert(['id' => 'inv-'.$key, 'product_id' => $id, 'quantity_base' => 0]);
                    $count++;
                }
            }

            return $count;
        });

        $this->command?->info("Bulfa Agrivet catalog: {$inserted} new products. Existing products were preserved.");
    }
}
