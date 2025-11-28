'use client'

import {
  useRouter as useNextRouter,
  useParams as useNextParams,
  useSearchParams as useNextSearchParams,
  type ReadonlyURLSearchParams,
} from 'next/navigation'

/**
 * Web implementation of the shared navigation hooks.
 * These are thin wrappers around Next.js' App Router utilities so that
 * shared feature code can stay platform-agnostic.
 */
export function useRouter() {
  return useNextRouter()
}

export function useParams<T extends Record<string, string>>() {
  return useNextParams() as unknown as T
}

export function useSearchParams(): ReadonlyURLSearchParams | null {
  return useNextSearchParams()
}
