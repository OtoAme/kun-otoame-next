import { cache } from 'react'
import { cookies } from 'next/headers'
import { verifyKunTokenResult } from '~/app/api/utils/jwt'
import { requireAvailableIdentity } from '~/app/api/utils/sessionIdentity'

export const getPageIdentity = cache(async () => {
  const cookieStore = await cookies()
  return requireAvailableIdentity(
    await verifyKunTokenResult(
      cookieStore.get('kun-galgame-patch-moe-token')?.value ?? ''
    )
  )
})
