export const canManageResource = ({
  resourceUserId,
  userId,
  userRole
}: {
  resourceUserId: number
  userId: number
  userRole: number
}) => resourceUserId === userId || userRole >= 3
