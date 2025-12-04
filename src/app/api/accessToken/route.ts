import { authenticateTrainerRequest } from '../_lib/accessToken'

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while validating access token',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  return new Response(null, { status: 204 })
}
