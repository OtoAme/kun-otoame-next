import {
  getRequestIdentity,
  requireAvailableIdentity
} from '~/app/api/utils/sessionIdentity'
import type { NextRequest } from 'next/server'

export const verifyHeaderCookie = async (req: NextRequest) =>
  requireAvailableIdentity(await getRequestIdentity(req))
