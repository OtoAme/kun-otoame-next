import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { hashPassword } from '~/app/api/utils/algorithm'
import { deleteKunToken } from '~/app/api/utils/jwt'
import { sendVerificationCodeEmail } from '~/app/api/utils/sendVerificationCodeEmail'
import { verifyVerificationCode } from '~/app/api/utils/verifyVerificationCode'
import { getRemoteIp } from '~/app/api/utils/getRemoteIp'
import { checkKunCaptchaExist } from '~/app/api/utils/verifyKunCaptcha'
import { getKv, setKv } from '~/lib/redis'
import { stepOneSchema, stepTwoSchema } from '~/validations/forgot'

export const stepOne = async (
  input: z.infer<typeof stepOneSchema>,
  headers: Headers
) => {
  const captchaValid = await checkKunCaptchaExist(input.captcha)
  if (!captchaValid) {
    return '人机验证无效, 请完成人机验证'
  }

  const ip = getRemoteIp(headers)
  const limitIP = await getKv(`limit:ip:${ip}`)
  if (limitIP) {
    return '您发送邮件的频率太快了, 请 60 秒后重试'
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
    await setKv(`limit:ip:${ip}`, '1', 60)
    return
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
    return '您的邮箱验证码无效'
  }

  const isCodeValid = await verifyVerificationCode(
    user.email,
    input.verificationCode
  )
  if (!isCodeValid) {
    return '您的邮箱验证码无效'
  }

  const hashedPassword = await hashPassword(input.newPassword)
  await deleteKunToken(user.id)

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword }
  })
}
