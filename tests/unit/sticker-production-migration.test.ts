import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const privateStickerSyncPath =
  'migration/production-private-chat-stickers-sync-2026-08-14.sql'
const adminStickerSyncPath =
  'migration/production-sticker-admin-sync-2026-08-14.sql'
const alignmentMigrationPath =
  'migration/production-stickers-prisma-alignment-2026-08-15.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production Sticker migration contract', () => {
  it('keeps the production sync DDL aligned with Prisma referential actions', async () => {
    const [privateSync, adminSync, stickerSchema, conversationSchema] =
      await Promise.all([
        readProjectFile(privateStickerSyncPath),
        readProjectFile(adminStickerSyncPath),
        readProjectFile('prisma/schema/sticker.prisma'),
        readProjectFile('prisma/schema/conversation.prisma')
      ])
    const combinedSync = `${privateSync}\n${adminSync}`

    expect(combinedSync.match(/ON UPDATE CASCADE/g)).toHaveLength(6)
    expect(combinedSync).not.toContain('ON UPDATE NO ACTION')
    expect(stickerSchema).toContain(
      'cover_sticker sticker? @relation("sticker_pack_cover", fields: [cover_sticker_id], references: [id], onDelete: SetNull)'
    )
    expect(conversationSchema).toContain('@@index([sticker_id])')
    expect(conversationSchema).toContain('@@index([reply_sticker_id])')
  })

  it('uses Prisma timestamp precision and updatedAt defaults', async () => {
    const privateSync = await readProjectFile(privateStickerSyncPath)

    expect(privateSync).toContain(
      'created timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP'
    )
    expect(privateSync).toContain(
      'acquired_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP'
    )
    expect(privateSync).toContain('ALTER COLUMN updated DROP DEFAULT')
    expect(privateSync).toContain('ALTER COLUMN media_type DROP DEFAULT')
    expect(privateSync).toContain('ALTER COLUMN width DROP DEFAULT')
    expect(privateSync).toContain('ALTER COLUMN height DROP DEFAULT')
    expect(privateSync).toContain('ALTER COLUMN size DROP DEFAULT')
  })

  it('provides a one-time idempotent production alignment without touching the known patch index drift', async () => {
    const alignment = await readProjectFile(alignmentMigrationPath)

    for (const constraint of [
      'sticker_pack_id_fkey',
      'user_sticker_pack_user_id_fkey',
      'user_sticker_pack_pack_id_fkey',
      'user_private_message_sticker_id_fkey',
      'user_private_message_reply_sticker_id_fkey',
      'sticker_pack_cover_sticker_id_fkey'
    ]) {
      expect(alignment).toContain(constraint)
    }

    expect(alignment).toContain('ALTER COLUMN created TYPE timestamp(3)')
    expect(alignment).toContain('ALTER COLUMN acquired_at TYPE timestamp(3)')
    expect(alignment).toContain('ALTER COLUMN updated DROP DEFAULT')
    expect(alignment).toContain('ALTER COLUMN media_type DROP DEFAULT')
    expect(alignment).toContain('ALTER COLUMN width DROP DEFAULT')
    expect(alignment).toContain('ALTER COLUMN height DROP DEFAULT')
    expect(alignment).toContain('ALTER COLUMN size DROP DEFAULT')
    const executableAlignment = stripSqlComments(alignment)
    expect(executableAlignment).not.toContain('patch_released_idx')
    expect(executableAlignment).not.toMatch(/DROP\s+INDEX/i)
  })

  it('documents the alignment step before the production Prisma guard', async () => {
    const [deployment, operations, stickerDocs] = await Promise.all([
      readProjectFile('docs/project/deployment.md'),
      readProjectFile('docs/modules/operations.md'),
      readProjectFile('docs/modules/private-chat-stickers.md')
    ])

    for (const source of [deployment, operations, stickerDocs]) {
      expect(source).toContain(
        'production-stickers-prisma-alignment-2026-08-15.sql'
      )
      expect(source).toContain('pnpm prisma:deploy-safe')
    }
  })
})
