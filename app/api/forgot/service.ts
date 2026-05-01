import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { hashPassword } from '~/app/api/utils/algorithm'
import { sendVerificationCodeEmail } from '~/app/api/utils/sendVerificationCodeEmail'
import { verifyVerificationCode } from '~/app/api/utils/verifyVerificationCode'
import { stepOneSchema, stepTwoSchema } from '~/validations/forgot'

export const stepOne = async (
  input: z.infer<typeof stepOneSchema>,
  headers: Headers
) => {
  const normalizedInput = input.name.toLowerCase()
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: normalizedInput, mode: 'insensitive' } },
        { name: { equals: normalizedInput, mode: 'insensitive' } }
      ]
    }
  })
  if (!user) {
    return '用户未找到'
  }

  const result = await sendVerificationCodeEmail(headers, user.email, 'forgot')
  if (result) {
    return result
  }
}

export const stepTwo = async (input: z.infer<typeof stepTwoSchema>) => {
  if (input.newPassword !== input.confirmPassword) {
    return '两次密码输入不一致'
  }

  const normalizedInput = input.name.toLowerCase()
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: normalizedInput, mode: 'insensitive' } },
        { name: { equals: normalizedInput, mode: 'insensitive' } }
      ]
    }
  })
  if (!user) {
    return '用户未找到'
  }

  const isCodeValid = await verifyVerificationCode(
    user.email,
    input.verificationCode
  )
  if (!isCodeValid) {
    return '您的邮箱验证码无效'
  }

  const hashedPassword = await hashPassword(input.newPassword)
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword }
  })
}
