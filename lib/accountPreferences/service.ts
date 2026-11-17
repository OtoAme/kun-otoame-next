import type { Prisma, PrismaClient } from '@prisma/client'
import type {
  PreferenceChange,
  PreferenceSnapshot,
  PreferenceValue
} from '~/types/api/preferences'

export type PreferenceTransaction = Prisma.TransactionClient
export type PreferenceDatabase = PrismaClient | PreferenceTransaction

type PreferenceRow = {
  id: number
  nsfw_mode: string | null
  enable_email_notice: boolean
  blocked_tag_ids: number[]
  preference_version: number
  versions: Record<string, number>
}

export class PreferenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409
  ) {
    super(message)
  }
}

const tagIdForKey = (key: string) =>
  key.startsWith('blocked-tag:') ? Number(key.slice(12)) : null

export const readPreferenceSnapshot = async (
  database: PreferenceDatabase,
  uid: number,
  context: string,
  keys: string[] = []
): Promise<PreferenceSnapshot> => {
  const rows = await database.$queryRaw<PreferenceRow[]>`
    SELECT u.id, u.nsfw_mode, u.enable_email_notice, u.blocked_tag_ids,
      u.preference_version, COALESCE((
        SELECT jsonb_object_agg(v.setting_key, v.version)
        FROM account_preference_version v WHERE v.user_id = u.id
        AND (v.setting_key IN ('nsfw', 'email-notice')
          OR v.setting_key = ANY(${keys}::text[])
          OR v.setting_key = ANY(ARRAY(SELECT 'blocked-tag:' || unnest(u.blocked_tag_ids))))
      ), '{}'::jsonb) AS versions
    FROM public."user" u WHERE u.id = ${uid}
  `
  const user = rows[0]
  if (!user)
    throw new PreferenceError('PREFERENCE_ACCOUNT_GONE', '账号已不存在', 401)
  const snapshot: PreferenceSnapshot = {
    uid,
    context,
    version: user.preference_version,
    nsfwSelected: user.nsfw_mode !== null,
    blockedTagIds: user.blocked_tag_ids,
    items: {}
  }
  const wanted = new Set([
    'nsfw',
    'email-notice',
    ...keys,
    ...user.blocked_tag_ids.map((tagId) => `blocked-tag:${tagId}`)
  ])
  for (const key of wanted) {
    const tagId = tagIdForKey(key)
    const value =
      key === 'nsfw'
        ? user.nsfw_mode === 'nsfw' || user.nsfw_mode === 'all'
          ? user.nsfw_mode
          : 'sfw'
        : key === 'email-notice'
          ? user.enable_email_notice
          : tagId !== null
            ? user.blocked_tag_ids.includes(tagId)
            : undefined
    if (value !== undefined)
      snapshot.items[key] = { value, version: user.versions[key] ?? 0 }
  }
  return snapshot
}

export const lockPreferenceTags = async (
  transaction: PreferenceTransaction,
  tagIds: number[]
) => {
  const ids = [...new Set(tagIds)].sort((first, second) => first - second)
  if (!ids.length) return
  const tags = await transaction.$queryRaw<{ id: number }[]>`
    SELECT id FROM patch_tag WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE
  `
  if (tags.length !== ids.length) {
    throw new PreferenceError(
      'PREFERENCE_TARGET_CHANGED',
      '标签已变化，请重新读取'
    )
  }
}

export const lockPreferenceAccounts = async (
  transaction: PreferenceTransaction,
  userIds: number[]
) => {
  const ids = [...new Set(userIds)].sort((first, second) => first - second)
  if (!ids.length) return
  return transaction.$queryRaw<{ id: number }[]>`
    SELECT id FROM public."user" WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE
  `
}

export const writePreferenceChanges = async (
  transaction: PreferenceTransaction,
  snapshot: PreferenceSnapshot,
  changes: { key: string; value: PreferenceValue }[],
  forceKeys: string[] = []
) => {
  const changed = changes.filter(
    (change) =>
      snapshot.items[change.key]?.value !== change.value ||
      (change.key === 'nsfw' && !snapshot.nsfwSelected) ||
      forceKeys.includes(change.key)
  )
  if (!changed.length) return snapshot
  let blockedTagIds = [...snapshot.blockedTagIds]
  const data: Prisma.userUpdateInput = { preference_version: { increment: 1 } }
  for (const change of changed) {
    if (change.key === 'nsfw') data.nsfw_mode = change.value as string
    else if (change.key === 'email-notice')
      data.enable_email_notice = change.value as boolean
    else {
      const tagId = tagIdForKey(change.key)
      if (tagId === null)
        throw new PreferenceError(
          'PREFERENCE_UNKNOWN_ITEM',
          '设置项目不存在',
          400
        )
      blockedTagIds = blockedTagIds.filter((blockedId) => blockedId !== tagId)
      if (change.value) blockedTagIds.push(tagId)
    }
    await transaction.account_preference_version.upsert({
      where: {
        user_id_setting_key: { user_id: snapshot.uid, setting_key: change.key }
      },
      create: { user_id: snapshot.uid, setting_key: change.key, version: 1 },
      update: { version: { increment: 1 } }
    })
  }
  if (changed.some((change) => tagIdForKey(change.key) !== null)) {
    data.blocked_tag_ids = [...new Set(blockedTagIds)]
  }
  await transaction.user.update({ where: { id: snapshot.uid }, data })
  return readPreferenceSnapshot(
    transaction,
    snapshot.uid,
    snapshot.context,
    Object.keys(snapshot.items)
  )
}

export const saveAccountPreferences = async (
  database: PrismaClient,
  uid: number,
  context: string,
  changes: PreferenceChange[]
) =>
  database.$transaction(
    async (transaction) => {
      const tagIds = changes
        .map((change) => tagIdForKey(change.key))
        .filter((tagId): tagId is number => tagId !== null)
      await lockPreferenceTags(transaction, tagIds)
      await lockPreferenceAccounts(transaction, [uid])
      const snapshot = await readPreferenceSnapshot(
        transaction,
        uid,
        context,
        changes.map((change) => change.key)
      )
      const conflicts = changes
        .filter(
          (change) =>
            snapshot.items[change.key].version !== change.version &&
            (snapshot.items[change.key].value !== change.value ||
              (change.key === 'nsfw' && !snapshot.nsfwSelected))
        )
        .map((change) => change.key)
      if (conflicts.length)
        return {
          code: 'PREFERENCE_CONFLICT' as const,
          message: '这些设置已在其他地方修改，请核对后再保存',
          conflicts,
          snapshot
        }
      return writePreferenceChanges(transaction, snapshot, changes)
    },
    { timeout: 10000 }
  )

export const setControlledEmailNotice = async (
  transaction: PreferenceTransaction,
  uid: number,
  enabled: boolean
) => {
  await lockPreferenceAccounts(transaction, [uid])
  const snapshot = await readPreferenceSnapshot(transaction, uid, '')
  return writePreferenceChanges(transaction, snapshot, [
    { key: 'email-notice', value: enabled }
  ])
}

export const maintainBlockedTagPreferences = async (
  transaction: PreferenceTransaction,
  sourceIds: number[],
  targetId?: number,
  extraUserIds: number[] = []
) => {
  const users = await transaction.user.findMany({
    where: { blocked_tag_ids: { hasSome: sourceIds } },
    select: { id: true },
    orderBy: { id: 'asc' }
  })
  await lockPreferenceAccounts(transaction, [
    ...users.map((user) => user.id),
    ...extraUserIds
  ])
  for (const user of users) {
    const keys = [
      ...sourceIds.map((tagId) => `blocked-tag:${tagId}`),
      ...(targetId ? [`blocked-tag:${targetId}`] : [])
    ]
    const snapshot = await readPreferenceSnapshot(
      transaction,
      user.id,
      '',
      keys
    )
    if (!snapshot.blockedTagIds.some((tagId) => sourceIds.includes(tagId)))
      continue
    await writePreferenceChanges(
      transaction,
      snapshot,
      [
        ...sourceIds.map((tagId) => ({
          key: `blocked-tag:${tagId}`,
          value: false
        })),
        ...(targetId ? [{ key: `blocked-tag:${targetId}`, value: true }] : [])
      ],
      keys
    )
  }
}

export const prepareAccountPreferenceDeletion = async (
  transaction: PreferenceTransaction,
  uid: number
) => {
  const ownedTags = await transaction.patch_tag.findMany({
    where: { user_id: uid },
    select: { id: true }
  })
  const tagIds = ownedTags.map((tag) => tag.id)
  await lockPreferenceTags(transaction, tagIds)
  await maintainBlockedTagPreferences(transaction, tagIds, undefined, [uid])
  const currentTags = await transaction.patch_tag.findMany({
    where: { user_id: uid },
    select: { id: true }
  })
  if (
    currentTags.length !== tagIds.length ||
    currentTags.some((tag) => !tagIds.includes(tag.id))
  ) {
    throw new PreferenceError(
      'PREFERENCE_TARGET_CHANGED',
      '账号标签已变化，请重试注销'
    )
  }
}
