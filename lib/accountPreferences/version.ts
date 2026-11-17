import { prisma } from '~/prisma'
export const readAccountPreferenceVersion = async (
  uid: number
): Promise<number | null> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { preference_version: true }
    })
    return user?.preference_version ?? null
  } catch {
    return null
  }
}
