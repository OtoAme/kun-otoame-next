import { prisma } from '~/prisma/index'

export const toggleEmailNotice = async (uid: number) => {
  const user = await prisma.user.findUnique({
    where: { id: uid }
  })
  if (user === null) {
    return '未找到用户'
  }

  await prisma.user.update({
    where: { id: uid },
    data: { enable_email_notice: !user.enable_email_notice }
  })
  return {}
}
