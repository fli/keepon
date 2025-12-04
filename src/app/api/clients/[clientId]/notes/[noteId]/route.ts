// Next.js requires route segment config exports to be defined in-file, not re-exported.
export const runtime = 'nodejs'

// Reuse the existing upsert handler for compatibility with the legacy PUT route
export { POST as PUT } from '../route'
