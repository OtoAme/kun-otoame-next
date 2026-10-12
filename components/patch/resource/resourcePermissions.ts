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
  resourceUserId: number
  userId: number
  userRole: number
}) => input.userId > 0 && (input.userRole >= 3 || canManageResourceLink(input))
