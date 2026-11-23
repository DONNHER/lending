<?php

use App\Http\Middleware\ApiRateLimit;
use App\Http\Middleware\AuthenticateSession;
use App\Http\Middleware\RequireRole;
use App\Support\Api;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(api: __DIR__.'/../routes/api.php', apiPrefix: 'api/v1')
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['argivit.auth' => AuthenticateSession::class, 'argivit.role' => RequireRole::class]);
        $middleware->api(prepend: [ApiRateLimit::class]);
        // Null and empty strings have different meanings in the existing API.
        $middleware->convertEmptyStringsToNull(except: [fn (Request $request) => $request->is('api/v1/*')]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/v1/*') || $request->expectsJson());
        $exceptions->render(function (ValidationException $exception, Request $request) {
            return $request->is('api/v1/*')
                ? Api::fail('The submitted data is invalid.', 422, $exception->errors())
                : null;
        });
        $exceptions->render(function (HttpExceptionInterface $exception, Request $request) {
            if (!$request->is('api/v1/*')) {
                return null;
            }
            return Api::fail($exception->getMessage() ?: 'The request could not be completed.', $exception->getStatusCode());
        });
    })->create();
