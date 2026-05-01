import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'
import { getUserFollowStatusSchema } from '~/validations/user'
import type { UserFollow } from '~/types/api/user'

export const getUserFollower = async (
  input: z.infer<typeof getUserFollowStatusSchema>,
  currentUserUid: number | undefined
) => {
  const { uid, page, limit } = input
  const offset = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.user_follow_relation.findMany({
      take: limit,
      skip: offset,
      where: { following_id: uid },
      include: {
        follower: {
          include: {
            follower: true,
            following: true
          }
        }
      }
    }),
    prisma.user_follow_relation.count({
      where: { following_id: uid }
    })
  ])

  const followers: UserFollow[] = data.map((r) => ({
    id: r.follower.id,
    name: r.follower.name,
    avatar: r.follower.avatar,
    bio: r.follower.bio,
    follower: r.follower.following.length,
    following: r.follower.follower.length,
    isFollow: r.follower.following
      .map((u) => u.follower_id)
      .includes(currentUserUid ?? 0)
  }))

  return { followers, total }
}

export const uidSchema = z.object({
  uid: z.coerce.number({ message: '请输入合法的用户 ID' }).min(1).max(9999999)
})

export const followUser = async (uid: number, currentUserUid: number) => {
  if (uid === currentUserUid) {
    return '您不能关注自己'
  }

  return prisma.$transaction(async (prisma) => {
    await prisma.user_follow_relation.create({
      data: {
        follower_id: currentUserUid,
        following_id: uid
      }
    })

    await createDedupMessage({
      type: 'follow',
      content: '关注了您!',
      sender_id: currentUserUid,
      recipient_id: uid,
      link: `/user/${currentUserUid}/resource`
    })

    return {}
  })
}

export const unfollowUser = async (uid: number, currentUserUid: number) => {
  if (uid === currentUserUid) {
    return '您不能取消关注自己'
  }

  await prisma.user_follow_relation.delete({
    where: {
      follower_id_following_id: {
        follower_id: currentUserUid,
        following_id: uid
      }
    }
  })

  return {}
}

export const getUserFollowing = async (
  input: z.infer<typeof getUserFollowStatusSchema>,
  currentUserUid: number | undefined
) => {
  const { uid, page, limit } = input
  const offset = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.user_follow_relation.findMany({
      take: limit,
      skip: offset,
      where: { follower_id: uid },
      include: {
        following: {
          include: {
            follower: true,
            following: true
          }
        }
      }
    }),
    prisma.user_follow_relation.count({
      where: { follower_id: uid }
    })
  ])

  const followings: UserFollow[] = data.map((r) => ({
    id: r.following.id,
    name: r.following.name,
    avatar: r.following.avatar,
    bio: r.following.bio,
    follower: r.following.following.length,
    following: r.following.follower.length,
    isFollow: r.following.following
      .map((u) => u.follower_id)
      .includes(currentUserUid ?? 0)
  }))

  return { followings, total }
}
