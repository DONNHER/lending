<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\EmailMfa;
use App\Support\EmailMfaPolicy;
use App\Support\PasswordSignIn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SecuritySettingsController extends Controller
{
    public function show(): JsonResponse
    {
        return Api::ok('Email MFA settings retrieved.', EmailMfaPolicy::status())->header('Cache-Control', 'no-store');
    }

    public function challenge(Request $request): JsonResponse
    {
        if (!EmailMfaPolicy::configurable()) {
            return Api::fail('Email MFA is managed by the external identity provider.', 409);
        }
        $input = $request->validate(['enabled' => 'required|boolean', 'password' => 'required|string']);
        $enabled = (bool) $input['enabled'];
        if (EmailMfaPolicy::enabled() === $enabled) {
            return Api::fail('Email MFA already has this setting.', 409);
        }
        $actor = Api::actor($request);
        $user = PasswordSignIn::verify($request, $actor['email'], $input['password']);
        if ($user instanceof JsonResponse) {
            return $user;
        }
        if ($user['id'] !== $actor['id']) {
            return Api::fail('Unable to confirm your account credentials.', 403);
        }

        return EmailMfa::issue($actor['id'], $user['password_hash'], purpose: $enabled ? 'require_mfa' : 'remove_mfa');
    }

    public function update(Request $request): JsonResponse
    {
        if (!EmailMfaPolicy::configurable()) {
            return Api::fail('Email MFA is managed by the external identity provider.', 409);
        }
        $input = $request->validate([
            'enabled' => 'required|boolean',
            'challenge_id' => 'required|uuid',
            'code' => ['required', 'string', 'regex:/\A[0-9]{6}\z/'],
        ]);
        $enabled = (bool) $input['enabled'];
        $actor = Api::actor($request);

        return EmailMfa::verify(
            $request, $input['challenge_id'], $input['code'], $enabled ? 'require_mfa' : 'remove_mfa', $actor['id'],
            static fn () => Api::ok('Email MFA settings updated.', EmailMfaPolicy::save($enabled, $actor))->header('Cache-Control', 'no-store'),
        );
    }
}
