<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DemoAccountsSeeder extends Seeder
{
    public function run(): void
    {
        $this->callWith(DemoSeeder::class, ['accountsOnly' => true]);
    }
}
