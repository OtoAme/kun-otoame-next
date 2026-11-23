import { prisma } from '~/prisma'
import { getRequestIdentity, requireAvailableIdentity } from './sessionIdentity'
import type { NextRequest } from 'next/server'

export const readAccountBrowsingPreferences = async (uid: number) => {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { nsfw_mode: true, blocked_tag_ids: true }
  })
  if (!user) throw new Error('账号偏好暂时不可用')
  return { mode: user.nsfw_mode ?? 'sfw', blockedTagIds: user.blocked_tag_ids }
}

const requests = new WeakMap<
  object,
  Promise<{ mode: string; blockedTagIds: number[] }>
>()
export const getRequestBrowsingPreferences = (req: NextRequest) => {
  let pending = requests.get(req)
  if (!pending) {
    pending = (async () => {
      const payload = requireAvailableIdentity(await getRequestIdentity(req))
      return payload
        ? readAccountBrowsingPreferences(payload.uid)
        : { mode: 'sfw', blockedTagIds: [] }
    })()
    requests.set(req, pending)
  }
  return pending
}
