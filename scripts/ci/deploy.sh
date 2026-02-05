#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf "\n[deploy] %s\n" "$*"
}

require_env() {
  local name
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      echo "Missing required env var: $name" >&2
      exit 1
    fi
  done
}

if [[ -n "${CI:-}" && -n "${GITHUB_SHA:-}" && -n "${GITHUB_REF_NAME:-}" ]]; then
  log "Verifying this run is still the latest on ${GITHUB_REF_NAME}."
  git fetch origin "${GITHUB_REF_NAME}" --depth=1
  head_sha="$(git rev-parse FETCH_HEAD)"
  if [[ "$head_sha" != "$GITHUB_SHA" ]]; then
    log "Stale run detected (HEAD is $head_sha). Skipping migrations and deploy."
    exit 0
  fi
fi

if compgen -G "vitest.config.*" > /dev/null; then
  log "Running Vitest."
  pnpm vitest run
else
  log "Vitest config not found. Skipping unit tests."
fi

if compgen -G "playwright.config.*" > /dev/null; then
  log "Running Playwright (chromium)."
  if [[ -n "${CI:-}" ]]; then
    pnpm playwright install --with-deps chromium
  else
    pnpm playwright install chromium
  fi
  pnpm playwright test --project=chromium
else
  log "Playwright config not found. Skipping e2e tests."
fi

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  require_env VERCEL_TOKEN VERCEL_PROJECT_ID VERCEL_ORG_ID
  if [[ "${SKIP_PULL:-}" != "1" ]]; then
    log "Pulling Vercel project settings and production env."
    pnpm vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
  else
    log "SKIP_PULL=1 set. Skipping Vercel pull."
  fi
  log "Building for production with Vercel."
  pnpm vercel build --prod --token "$VERCEL_TOKEN"
else
  log "SKIP_BUILD=1 set. Skipping Vercel build."
fi

if [[ "${SKIP_MIGRATE:-}" != "1" ]]; then
  require_env DATABASE_URL_PROD
  log "Ensuring dbmate baseline on existing databases."
  node scripts/ci/ensure-dbmate-baseline.js
  log "Applying database migrations."
  pnpm db:migrate:prod
else
  log "SKIP_MIGRATE=1 set. Skipping migrations."
fi

if [[ "${SKIP_DEPLOY:-}" != "1" ]]; then
  if [[ "${SKIP_BUILD:-}" == "1" ]]; then
    echo "Cannot deploy with SKIP_BUILD=1. Run the build or unset SKIP_BUILD." >&2
    exit 1
  fi
  require_env VERCEL_TOKEN VERCEL_PROJECT_ID VERCEL_ORG_ID
  log "Deploying to production with prebuilt output."
  pnpm vercel deploy --prebuilt --prod --archive=tgz --token "$VERCEL_TOKEN" --yes
else
  log "SKIP_DEPLOY=1 set. Skipping deployment."
fi
