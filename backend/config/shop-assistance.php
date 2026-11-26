<?php

return [
    'gemini_key' => (string) env('GEMINI_API_KEY', ''),
    'gemini_model' => env('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
    'ollama_url' => rtrim((string) env('OLLAMA_BASE_URL', ''), '/'),
    'ollama_model' => env('OLLAMA_MODEL', 'qwen2.5:1.5b'),
];
