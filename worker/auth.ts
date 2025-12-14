import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

export type AuthContext = {
  uid: string
  email?: string
  name?: string
  picture?: string
  raw: JWTPayload
}

const FIREBASE_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
)

// jose caches fetched keys internally.
const jwks = createRemoteJWKSet(FIREBASE_JWKS_URL)

export async function verifyFirebaseIdToken(opts: {
  idToken: string
  firebaseProjectId: string
}): Promise<AuthContext> {
  const { idToken, firebaseProjectId } = opts

  if (!firebaseProjectId) {
    throw new Error('FIREBASE_PROJECT_ID is not configured')
  }

  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://securetoken.google.com/${firebaseProjectId}`,
    audience: firebaseProjectId,
  })

  if (!payload.sub) {
    throw new Error('Firebase token missing sub')
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    raw: payload,
  }
}

export function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!auth) return null

  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m?.[1] ?? null
}
