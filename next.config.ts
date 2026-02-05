import type { NextConfig } from 'next'
import { withWorkflow } from 'workflow/next'

const nextConfig: NextConfig = {
  typedRoutes: true,
  cacheComponents: true,
  typescript: {
    // Allow production builds even if the project has type errors.
    ignoreBuildErrors: true,
  },
}

export default withWorkflow(nextConfig, {
  workflows: {
    local: { port: 3001 },
    dirs: ['app', 'src/app', 'src/workflows'],
  },
})
