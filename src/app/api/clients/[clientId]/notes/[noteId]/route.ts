// Next.js requires route segment config exports to be defined in-file, not re-exported.

// Reuse the existing upsert handler for compatibility with the legacy PUT route
export { POST as PUT } from '../route'
