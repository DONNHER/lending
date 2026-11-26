<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('user_sessions', function (Blueprint $table): void {
            $table->string('last_active_at')->nullable();
            $table->unsignedSmallInteger('remembered')->default(1);
            $table->string('device', 255)->nullable();
            $table->index(['user_id', 'revoked_at']);
        });
        Schema::table('email_mfa_challenges', function (Blueprint $table): void {
            $table->unsignedSmallInteger('remembered')->default(1);
        });
    }

    public function down(): void
    {
        Schema::table('user_sessions', function (Blueprint $table): void {
            $table->dropIndex(['user_id', 'revoked_at']);
            $table->dropColumn(['last_active_at', 'remembered', 'device']);
        });
        Schema::table('email_mfa_challenges', function (Blueprint $table): void {
            $table->dropColumn('remembered');
        });
    }
};
