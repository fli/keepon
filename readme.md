# Keepon Monorepo 🕴

Cross-platform codebase for the Keepon product using Expo for native and Next.js for web. Shared UI and feature logic live in `packages/app`, and a small navigation bridge (`packages/app/navigation`) keeps routing consistent between React Navigation (native) and the Next.js App Router (web).

## Stack
- Next.js 16 (React 19 + React Compiler beta)
- Expo SDK 54 / React Native 0.82 (New Architecture)
- React Navigation 7 on native; custom hooks for web/native parity
- React Query, Moti, ORPC/Kysely tooling

## Layout
- `apps/expo` — native app entry
- `apps/next` — web app entry
- `packages/app` — shared UI, features, providers, navigation helpers
- `packages/db`, `packages/keepon-api`, `packages/orpc` — data and API helpers

## Getting started
- Install dependencies: `yarn install`
- Web dev: `yarn web` (runs `yarn workspace next-app dev`)
- Native dev:
  - Build a dev client once (`cd apps/expo && expo run:ios` or `expo run:android`)
  - Start Metro from the repo root: `yarn native`

## Database migrations
- Copy `.env.example` to `.env` and set `DATABASE_URL`.
- Apply migrations: `yarn dbmate:up` (schema snapshot in `db/schema.sql`).
- Create a migration: `yarn dbmate:new add_users_table`.
- Check status: `yarn dbmate:status`; roll back latest with `yarn dbmate:down`.

## Adding dependencies
- Shared JS deps: `yarn workspace app add <package>`
- Native deps (with native code): `yarn workspace expo-app add <package>` and keep versions in sync if also used in `packages/app`.
