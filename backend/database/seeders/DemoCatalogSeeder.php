<?php

namespace Database\Seeders;

use App\Support\Api;
use App\Support\Sales;
use App\Support\Sessions;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class DemoCatalogSeeder extends Seeder
{
    public function run(): void
    {
        if (!app()->environment('local', 'testing')
            || (DB::connection()->getDriverName() !== 'sqlite' && !Sessions::allowsLocalDockerAuth())) {
            throw new RuntimeException('Load demo inventory only into SQLite or local Docker PostgreSQL.');
        }

        $fixture = json_decode(file_get_contents(__DIR__.'/demo.json'), true, flags: JSON_THROW_ON_ERROR);
        $animalCare = json_decode(file_get_contents(__DIR__.'/demo-animal-care.json'), true, flags: JSON_THROW_ON_ERROR);
        $products = [...$fixture['products'], ...$animalCare['products']];
        $balances = array_column([...$fixture['inventory_balances'], ...$animalCare['inventory_balances']], null, 'product_id');
        $units = collect([...$fixture['product_units'], ...$animalCare['product_units']])->groupBy('product_id');

        DB::transaction(function () use ($animalCare, $products, $balances, $units): void {
            $actor = DB::table('users')->where('id', 'usr-admin')->where('role', 'admin')->value('id');
            if ($actor === null) {
                throw new RuntimeException('Create the demo accounts with DemoAccountsSeeder first.');
            }

            DB::table('categories')->insertOrIgnore($animalCare['categories']);

            $now = Api::now();
            foreach ($products as $product) {
                $id = $product['id'];
                $product['created_at'] = $now;
                if (DB::table('products')->insertOrIgnore($product) === 0) {
                    continue;
                }

                $balance = $balances[$id];
                $openingStock = (float) $balance['quantity_base'];
                $balance['quantity_base'] = 0;
                DB::table('product_units')->insert($units[$id]->all());
                DB::table('inventory_balances')->insert($balance);
                if ($openingStock > 0) {
                    Sales::moveStock($id, $openingStock, 'receipt', 'product_init', $id, $actor, 'Opening stock from demo catalog', $now);
                }
            }
        });
    }
}
