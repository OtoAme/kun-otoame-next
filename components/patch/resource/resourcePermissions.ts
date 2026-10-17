import { parseResourceLink } from '~/utils/resourceLink'
import { recognizeLinkCheckProvider } from '~/utils/recognizeLinkCheckProvider'

export const canManageResource = ({
  resourceUserId,
  userId,
  userRole
}: {
  resourceUserId: number
  userId: number
  userRole: number
}) => resourceUserId === userId || userRole >= 3

/** Link ownership is independent from permission to edit its resource. */
export const canManageResourceLink = ({
  storage,
  resourceUserId,
  userId,
  userRole
}: {
  storage: string
  resourceUserId: number
  userId: number
  userRole: number
}) =>
  userId > 0 &&
  (storage === 'touchgal' ? userRole >= 3 : resourceUserId === userId)

export const canCheckResourceLink = (input: {
  storage: string
  content: string
  resourceUserId: number
  userId: number
  userRole: number
}) => {
  if (!(input.userId > 0 && input.userRole >= 1)) return false
  const scheme = input.content.trim().match(/^([a-z][a-z\d+.-]*):/i)?.[1]
  if (scheme && !/^https?$/i.test(scheme)) return false
  const { url } = parseResourceLink(input.content)
  return /^https?:\/\/[^/\\]/i.test(url) && recognizeLinkCheckProvider(url) !== null
}
