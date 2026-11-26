<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_settings', function (Blueprint $table): void {
            $table->unsignedSmallInteger('id')->primary();
            $table->unsignedSmallInteger('email_mfa_enabled');
        });
        Schema::table('email_mfa_challenges', function (Blueprint $table): void {
            $table->string('purpose')->default('sign_in');
            $table->unique(['user_id', 'purpose']);
            $table->dropUnique(['user_id']);
        });
    }

    public function down(): void
    {
        DB::table('email_mfa_challenges')->where('purpose', '!=', 'sign_in')->delete();
        Schema::table('email_mfa_challenges', function (Blueprint $table): void {
            $table->unique(['user_id']);
            $table->dropUnique(['user_id', 'purpose']);
            $table->dropColumn('purpose');
        });
        Schema::dropIfExists('security_settings');
    }
};
