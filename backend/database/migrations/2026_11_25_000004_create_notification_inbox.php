<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_notifications', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->text('user_id');
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->string('event_key', 120);
            $table->string('kind', 20);
            $table->string('title');
            $table->text('message');
            $table->string('created_at');
            $table->string('read_at')->nullable();
            $table->string('dismissed_at')->nullable();
            $table->unique(['user_id', 'event_key']);
            $table->index(['user_id', 'dismissed_at', 'created_at']);
        });
        Schema::create('notification_preferences', function (Blueprint $table): void {
            $table->text('user_id');
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->string('kind', 20);
            $table->unsignedSmallInteger('enabled');
            $table->primary(['user_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_preferences');
        Schema::dropIfExists('user_notifications');
    }
};
