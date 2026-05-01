import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { adminSendEmailSchema } from '~/validations/admin'
import { sendEmailHTML } from './_send'

export const sendBulkEmail = async (
  input: z.infer<typeof adminSendEmailSchema>,
  uid: number
) => {
  const admin = await prisma.user.findUnique({ where: { id: uid } })
  if (!admin) {
    return '未找到该管理员'
  }

  const { templateId, variables } = input

  const users = await prisma.user.findMany({
    where: { enable_email_notice: true },
    select: { email: true }
  })

  const emailList = users.map((user) => user.email)

  const batchSize = 100
  for (let i = 0; i < emailList.length; i += batchSize) {
    const batch = emailList.slice(i, i + batchSize)

    await Promise.all(
      batch.map((email) => sendEmailHTML(templateId, variables, email))
    )
  }

  await prisma.admin_log.create({
    data: {
      type: 'create',
      user_id: uid,
      content: `管理员 ${admin.name} 向全体用户发送了邮件\n\n${JSON.stringify(variables)}`
    }
  })

  return { count: emailList.length }
}
