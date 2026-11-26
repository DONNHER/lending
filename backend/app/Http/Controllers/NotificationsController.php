<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\NotificationInbox;
use App\Support\Sessions;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class NotificationsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return Api::ok('Notifications retrieved.', $this->snapshot(Api::actor($request)['id']))
            ->header('Cache-Control', 'no-store');
    }

    public function stream(Request $request): JsonResponse|StreamedResponse
    {
        $actor = Api::actor($request);
        $session = $request->attributes->get('argivit.session');
        if (!config('argivit.notification_stream') || $session === null || $request->attributes->has('argivit.impersonator')) {
            return Api::fail('Live streaming is unavailable for this session.', 409);
        }

        return response()->stream(function () use ($actor, $session): void {
            $previous = null;
            for ($attempt = 0; $attempt < 10 && !connection_aborted(); $attempt++) {
                if (Sessions::validOrigin($session, $actor) === null) {
                    return;
                }
                $encoded = json_encode($this->snapshot($actor['id']), JSON_THROW_ON_ERROR);
                if ($encoded !== $previous) {
                    echo 'data: '.$encoded."\n\n";
                    $previous = $encoded;
                } else {
                    echo ": keep-alive\n\n";
                }
                if (ob_get_level() > 0) {
                    ob_flush();
                }
                flush();
                if ($attempt < 9) {
                    sleep(2);
                }
            }
        }, 200, ['Content-Type' => 'text/event-stream', 'Cache-Control' => 'no-cache, no-store', 'X-Accel-Buffering' => 'no']);
    }

    public function markRead(Request $request): JsonResponse
    {
        $this->inbox(Api::actor($request)['id'])->whereNull('read_at')->update(['read_at' => Api::now()]);

        return Api::ok('All notifications marked as read.');
    }

    public function dismiss(Request $request, string $id): JsonResponse
    {
        $this->inbox(Api::actor($request)['id'])->where('id', $id)->update(['dismissed_at' => Api::now()]);

        return Api::ok('Notification removed.');
    }

    public function preference(Request $request): JsonResponse
    {
        $input = $request->validate(['kind' => ['required', Rule::in(NotificationInbox::KINDS)], 'enabled' => 'required|boolean']);
        DB::table('notification_preferences')->upsert([
            'user_id' => Api::actor($request)['id'], 'kind' => $input['kind'], 'enabled' => (int) $input['enabled'],
        ], ['user_id', 'kind'], ['enabled']);

        return Api::ok('Notification preference saved.');
    }

    private function snapshot(string $userId): array
    {
        $query = $this->inbox($userId);
        $preferences = array_map(static fn ($enabled): bool => (bool) $enabled,
            DB::table('notification_preferences')->where('user_id', $userId)->pluck('enabled', 'kind')->all());

        return [
            'items' => (clone $query)->orderByDesc('created_at')->orderByDesc('id')->limit(30)->get(['id', 'kind', 'title', 'message', 'created_at', 'read_at']),
            'unread' => (clone $query)->whereNull('read_at')->count(),
            'preferences' => $preferences + array_fill_keys(NotificationInbox::KINDS, true),
            'stream_enabled' => (bool) config('argivit.notification_stream'),
        ];
    }

    private function inbox(string $userId): Builder
    {
        return DB::table('user_notifications')->where('user_id', $userId)->whereNull('dismissed_at');
    }
}
