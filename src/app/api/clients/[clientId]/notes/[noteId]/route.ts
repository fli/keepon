export { runtime } from '../route'

// Reuse the existing upsert handler for compatibility with the legacy PUT route
export { POST as PUT } from '../route'
