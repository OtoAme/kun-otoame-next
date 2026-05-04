import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { searchUserSchema } from '~/validations/user'

export const searchUser = async (input: z.infer<typeof searchUserSchema>) => {
  const { query } = input

  const users: KunUser[] = await prisma.user.findMany({
    where: {
      name: { contains: query, mode: 'insensitive' }
    },
    select: {
      id: true,
      name: true,
      avatar: true
    },
    take: 50
  })

  return users
}
