import { createHash } from 'crypto'
import { parseCookies } from '~/utils/cookies'
import { verifyKunTokenResult, SessionUnavailableError } from './jwt'
import type { KunGalgamePayload, KunIdentityResult } from './jwt'

const requestIdentities = new WeakMap<object, Promise<KunIdentityResult>>()

export const getRequestIdentity = (req: Pick<Request, 'headers'>) => {
  let identity = requestIdentities.get(req)
  if (!identity) {
    const token = parseCookies(req.headers.get('cookie') ?? '')[
      'kun-galgame-patch-moe-token'
    ]
    identity = verifyKunTokenResult(token ?? '')
    requestIdentities.set(req, identity)
  }
  return identity
}

export const requireAvailableIdentity = (identity: KunIdentityResult) => {
  if (identity.status === 'unavailable') {
    throw new SessionUnavailableError()
  }
  return identity.status === 'authenticated' ? identity.payload : null
}

export const getSessionContext = (payload: KunGalgamePayload) => {
  if (!payload.jti || !Number.isSafeInteger(payload.uid) || payload.uid <= 0) {
    throw new SessionUnavailableError()
  }
  return createHash('sha256')
    .update(`${payload.uid}:${payload.jti}`)
    .digest('hex')
}
