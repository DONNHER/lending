#!/usr/bin/env bash
set -Eeuo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
state="${ARGIVET_STATE_DIR:-$HOME/.config/argivet-ledger}"
updater_env="${TUNNEL_UPDATER_ENV:-$state/tunnel-updater.env}"
tunnel_container="${AGRIVET_TUNNEL_CONTAINER:-agrivet-loan-vite-tunnel}"
frontend_service="${AGRIVET_FRONTEND_SERVICE:-agrivet-frontend-dev}"
local_health_url="${AGRIVET_LOCAL_HEALTH_URL:-http://127.0.0.1:5173/api/v1/health}"
permanent_url="${PERMANENT_TUNNEL_URL:-https://agrivet-store.agrivet-ledger.workers.dev}"
github_repo="${GITHUB_REPOSITORY:-DONNHER/Agrivet_Ledger}"
release_tag="${AGRIVET_RELEASE_TAG:-live-url}"

mkdir -p "$state"
exec 8>"$state/tunnel-watchdog.lock"
flock -n 8 || { echo "Another tunnel watchdog run is already active."; exit 0; }

if [[ -f "$updater_env" ]]; then
  # shellcheck disable=SC1090
  source "$updater_env"
  permanent_url="${PERMANENT_TUNNEL_URL:-$permanent_url}"
fi

uid="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$uid}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$uid/bus}"

is_healthy() {
  local url="$1"
  local body
  body="$(curl -fsS --max-time 10 "$url" 2>/dev/null || true)"
  [[ "$body" == *'"status":"online"'* ]]
}

# 1. Ensure local Vite frontend + API proxy are online
if ! is_healthy "$local_health_url"; then
  echo "Local frontend health check failed; restarting $frontend_service..."
  if systemctl --user list-unit-files "${frontend_service}.service" >/dev/null 2>&1; then
    systemctl --user restart "$frontend_service"
  fi
  local_ready=0
  for _ in $(seq 1 30); do
    if is_healthy "$local_health_url"; then
      local_ready=1
      break
    fi
    sleep 1
  done
  if [[ "$local_ready" -ne 1 ]]; then
    echo "Local frontend $local_health_url did not become healthy." >&2
    exit 1
  fi
fi

# 2. Check current Quick Tunnel URL (2 attempts before rotating)
extract_url() {
  local since_flag="${1:-}"
  if [[ -n "$since_flag" ]]; then
    docker logs --since "$since_flag" "$tunnel_container" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.trycloudflare\.com$' | tail -n 1 || true
  else
    docker logs "$tunnel_container" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.trycloudflare\.com$' | tail -n 1 || true
  fi
}

current_url="$(extract_url)"
tunnel_healthy=0
if [[ -n "$current_url" ]]; then
  for attempt in 1 2; do
    if is_healthy "${current_url}/api/v1/health"; then
      tunnel_healthy=1
      break
    fi
    [[ "$attempt" -eq 1 ]] && sleep 4
  done
fi

live_url="$current_url"
if [[ "$tunnel_healthy" -ne 1 ]]; then
  echo "Current public tunnel URL (${current_url:-none}) is unreachable or expired. Restarting $tunnel_container..."
  restart_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker restart "$tunnel_container" >/dev/null

  live_url=""
  for _ in $(seq 1 40); do
    logs="$(docker logs --since "$restart_ts" "$tunnel_container" 2>&1 || true)"
    candidate="$(printf '%s\n' "$logs" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.trycloudflare\.com$' | tail -n 1 || true)"
    if [[ -n "$candidate" ]] && printf '%s\n' "$logs" | grep -Fq 'Registered tunnel connection'; then
      live_url="$candidate"
      break
    fi
    sleep 1
  done

  if [[ -z "$live_url" ]]; then
    echo "Timed out waiting for $tunnel_container to register a new Quick Tunnel URL." >&2
    docker logs --tail 30 "$tunnel_container" >&2 || true
    exit 1
  fi

  echo "Waiting for DNS and health on new URL: $live_url"
  new_ready=0
  for _ in $(seq 1 20); do
    if is_healthy "${live_url}/api/v1/health"; then
      new_ready=1
      break
    fi
    sleep 2
  done
  if [[ "$new_ready" -ne 1 ]]; then
    echo "New Quick Tunnel URL $live_url failed health verification." >&2
    exit 1
  fi
fi

commit_sha="${GITHUB_SHA:-$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo unknown)}"
short_sha="${commit_sha:0:7}"
now_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 3. Update permanent Cloudflare Worker redirect if out of sync
if [[ -n "${TUNNEL_UPDATE_SECRET:-}" ]]; then
  current_target="$(curl -fsS --max-time 10 "${permanent_url}/_status" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("target_url") or "")' 2>/dev/null || true)"
  if [[ "$current_target" != "$live_url" ]]; then
    payload="$(python3 -c 'import json,sys; print(json.dumps({"url": sys.argv[1], "commit": sys.argv[2]}))' "$live_url" "$commit_sha")"
    curl -fsS --max-time 15 -X POST "${permanent_url}/_update" \
      -H "Authorization: Bearer ${TUNNEL_UPDATE_SECRET}" \
      -H "Content-Type: application/json" \
      -d "$payload" >/dev/null
    echo "Updated permanent link ${permanent_url} -> ${live_url}"
  else
    echo "Permanent link ${permanent_url} already points to ${live_url}"
  fi
else
  echo "TUNNEL_UPDATE_SECRET not configured; skipping permanent Worker update." >&2
fi

# 4. Publish/update rolling GitHub Release when GITHUB_TOKEN is available
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  release_body="$(cat <<EOF
### Argivit Store Public Access

- **Permanent URL (always active):** ${permanent_url}
- **Current Direct Tunnel URL:** ${live_url}
- **Commit:** \`${short_sha}\`
- **Last Verified (UTC):** ${now_utc}

> Bookmark the **Permanent URL** above—it automatically redirects to the latest healthy Cloudflare Quick Tunnel whenever the Kali server rotates an expired link.
EOF
)"
  existing_id="$(curl -fsS --max-time 15 \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${github_repo}/releases/tags/${release_tag}" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"

  if [[ -n "$existing_id" ]]; then
    req_body="$(python3 -c 'import json,sys; print(json.dumps({"name": "Live Public URL", "body": sys.argv[1], "draft": False, "prerelease": False}))' "$release_body")"
    curl -fsS --max-time 15 -X PATCH \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/${github_repo}/releases/${existing_id}" \
      -d "$req_body" >/dev/null
    echo "Updated GitHub Release '${release_tag}' on ${github_repo}"
  else
    req_body="$(python3 -c 'import json,sys; print(json.dumps({"tag_name": sys.argv[1], "target_commitish": "main", "name": "Live Public URL", "body": sys.argv[2], "draft": False, "prerelease": False}))' "$release_tag" "$release_body")"
    curl -fsS --max-time 15 -X POST \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/${github_repo}/releases" \
      -d "$req_body" >/dev/null
    echo "Created GitHub Release '${release_tag}' on ${github_repo}"
  fi
fi

echo "PERMANENT_URL=${permanent_url}"
echo "DIRECT_TUNNEL_URL=${live_url}"
