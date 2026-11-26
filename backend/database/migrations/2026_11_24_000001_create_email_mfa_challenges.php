<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_mfa_challenges', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->text('user_id')->unique();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->string('code_digest', 64);
            $table->unsignedSmallInteger('failed_attempts')->default(0);
            $table->string('expires_at');
            $table->string('created_at');
            $table->string('used_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_mfa_challenges');
    }
};
