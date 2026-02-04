import type { NextConfig } from 'next'
import { withWorkflow } from 'workflow/next'

const nextConfig: NextConfig = {
  typedRoutes: true,
  cacheComponents: true,
}

export default withWorkflow(nextConfig, {
  workflows: {
    local: { port: 3001 },
    dirs: ['app', 'src/app', 'src/workflows'],
  },
})
