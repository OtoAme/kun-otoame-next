'use server'

import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import {
  getProfileSchema,
  getUserProfile
} from '~/app/api/user/status/info/service'

export const kunGetActions = async (id: number) => {
  const input = safeParseSchema(getProfileSchema, { id })
  if (typeof input === 'string') {
    return input
  }
  const payload = await verifyHeaderCookie()

  const user = await getUserProfile(input, payload?.uid ?? 0)
  return user
}
