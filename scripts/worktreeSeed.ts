import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prisma, disconnectPrismaAdapter } from '../prisma/index'
import { hashPassword } from '../app/api/utils/algorithm'
import { createMoemoepointOpeningEntry } from '../app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '../constants/moemoepoint'

export const seedWorktreeDatabase = async () => {
  const id = process.env.OTOAME_WORKTREE_ID ?? ''
  const nonce = process.env.OTOAME_WORKTREE_NONCE ?? ''
  const password = process.env.OTOAME_WORKTREE_PASSWORD ?? ''
  if (
    !/^[a-f0-9]{12}$/.test(id) ||
    !/^[a-f0-9]{64}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(password)
  ) {
    throw new Error('缺少受管 worktree 身份或开发账号凭据。')
  }
  const target = new URL(process.env.KUN_DATABASE_URL ?? '')
  if (
    target.hostname !== '127.0.0.1' ||
    target.pathname !== `/otoame_wt_${id}` ||
    decodeURIComponent(target.username) !== `otoame_wt_${id}`
  ) {
    throw new Error('开发数据只允许写入当前 worktree 的本机独立数据库。')
  }
  const hashed = await hashPassword(password)
  await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; nonce: string; phase: string }[]
      >`
      SELECT id, nonce, phase FROM worktree_meta.identity FOR UPDATE
    `
      if (rows.length !== 1 || rows[0].id !== id || rows[0].nonce !== nonce) {
        throw new Error('数据库身份标记不符。')
      }
      if (rows[0].phase === 'ready') return
      if (rows[0].phase !== 'schema' || (await tx.user.count()) !== 0) {
        throw new Error('开发数据初始化要求本次创建的空库，拒绝覆盖现有用户。')
      }
      let adminId = 0
      for (const [name, role] of [
        ['wt_admin', 4],
        ['wt_author', 2],
        ['wt_user', 1]
      ] as const) {
        const user = await tx.user.create({
          data: {
            name,
            role,
            email: `${name}@example.invalid`,
            password: hashed,
            moemoepoint: 1000,
            enable_email_notice: false
          }
        })
        await createMoemoepointOpeningEntry(tx, {
          userId: user.id,
          balance: 1000,
          reasonCode: MOEMOEPOINT_REASON.accountCreated.code,
          reason: '本地开发初始余额',
          idempotencyKey: `worktree:${id}:${name}`
        })
        if (role === 4) adminId = user.id
      }
      await tx.patch.create({
        data: {
          unique_id: 'wt000001',
          name: 'Worktree 示例条目',
          user_id: adminId,
          introduction: '仅供本地开发的合成条目。',
          content_limit: 'sfw',
          type: [],
          language: [],
          engine: [],
          platform: [],
          rating_stat: { create: {} }
        }
      })
      await tx.$executeRaw`UPDATE worktree_meta.identity SET phase='ready' WHERE id=${id}`
    },
    { timeout: 30_000 }
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  seedWorktreeDatabase()
    .catch(() => {
      console.error('合成开发数据准备失败，请检查本次数据库标记与初始化前提。')
      process.exitCode = 1
    })
    .finally(disconnectPrismaAdapter)
}
