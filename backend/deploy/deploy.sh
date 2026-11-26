#!/usr/bin/env bash
set -Eeuo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
state="${ARGIVET_STATE_DIR:-$HOME/.config/argivet-ledger}"
version="${1:-$(git -C "$repo" rev-parse HEAD)}"
mode="${2:-deploy}"
if [[ ! "$version" =~ ^[0-9a-f]{40}$ ]] || [[ "$mode" != deploy && "$mode" != rollback && "$mode" != prebuilt ]]; then
  echo "Usage: deploy.sh <40-character commit SHA> [deploy|prebuilt|rollback]" >&2
  exit 2
fi
env_file="$state/server.env"
[[ -f "$env_file" ]] || { echo "Missing server settings: $env_file" >&2; exit 2; }
exec 9>"$state/deploy.lock"
flock 9
compose() { APP_VERSION="$1" docker compose --env-file "$env_file" -f "$repo/backend/deploy/compose.yaml" "${@:2}"; }
verify() {
  local expected="$1" service result
  for service in pos_api loan_api; do
    result="$(compose "$expected" exec -T "$service" php -r '$d=json_decode(file_get_contents("http://127.0.0.1/api/v1/health"),true); echo $d["version"] ?? "";')"
    [[ "$result" == "$expected" ]] || return 1
  done
  compose "$expected" exec -T loan_web sh -ec '[ "$(wget -qO- http://127.0.0.1:8080/health)" ] && wget -qO- http://127.0.0.1:8080/health | grep -Fq "\"version\":\"$1\""' sh "$expected"
}
start() { compose "$1" up -d --no-build --wait --wait-timeout 120 pos_api loan_api loan_web scheduler && verify "$1"; }
previous="$(cat "$state/current-release" 2>/dev/null || true)"

if [[ "$mode" != rollback ]]; then
  [[ "$version" == "$(git -C "$repo" rev-parse HEAD)" ]] || { echo "Checkout must match the release SHA." >&2; exit 2; }
  if [[ "$mode" == deploy ]]; then compose "$version" build pos_api loan_web; fi
  compose "$version" up -d --wait postgres
  compose "$version" run --rm --no-deps --user www-data pos_api php artisan migrate --force --no-interaction
  compose "$version" run --rm --no-deps --user www-data pos_api php artisan db:seed --class=DatabaseSeeder --force --no-interaction
fi

if start "$version"; then
  printf '%s\n' "$version" > "$state/current-release.tmp"
  mv "$state/current-release.tmp" "$state/current-release"
  echo "Verified release $version on POS and loans"
elif [[ "$mode" != rollback && "$previous" =~ ^[0-9a-f]{40}$ && "$previous" != "$version" ]]; then
  echo "Release failed health checks. Restoring application images for $previous." >&2
  start "$previous"
  exit 1
else
  echo "Release failed health checks." >&2
  exit 1
fi
