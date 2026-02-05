#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${WORKFLOW_DISPATCH_URL:-}" ]]; then
  echo "WORKFLOW_DISPATCH_URL is required." >&2
  exit 1
fi

dispatch_token="${WORKFLOW_OUTBOX_DISPATCH_SECRET:-${CRON_SECRET:-}}"
limit="${WORKFLOW_DISPATCH_LIMIT:-20}"

args=(
  -fsS
  -X POST
  "${WORKFLOW_DISPATCH_URL}?limit=${limit}"
)

if [[ -n "${dispatch_token}" ]]; then
  args+=( -H "Authorization: Bearer ${dispatch_token}" )
fi

curl "${args[@]}"
