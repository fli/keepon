#!/usr/bin/env bash
set -euo pipefail

route_types_stub='// Minimal stub for CI when Next route types are not generated.
// This avoids type errors for RouteContext during lint/type-checking.
export {}

declare global {
  interface RouteContext<AppRouteHandlerRoute extends string = string> {
    params: Promise<Record<string, string | string[] | undefined>>
  }
}
'

for target in ".next/dev/types/routes.d.ts" ".next/types/routes.d.ts"; do
  if [[ ! -f "$target" ]]; then
    mkdir -p "$(dirname "$target")"
    printf "%s\n" "$route_types_stub" > "$target"
  fi
done
