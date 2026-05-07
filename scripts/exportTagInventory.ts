import 'dotenv/config'
import { writeFile } from 'fs/promises'
import { prisma } from '~/prisma/index'

const getArgValue = (name: string) => {
  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

const escapeCsvValue = (value: unknown) => {
  const text = Array.isArray(value)
    ? value.join('|')
    : value instanceof Date
      ? value.toISOString()
      : String(value ?? '')

  if (!/[",\n]/.test(text)) {
    return text
  }

  return `"${text.replaceAll('"', '""')}"`
}

const toCsv = (rows: TagInventoryRow[]) => {
  const headers = [
    'id',
    'name',
    'alias',
    'source',
    'introduction',
    'storedCount',
    'actualCount',
    'created',
    'updated',
    'samplePatches'
  ]

  return [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header as keyof TagInventoryRow])).join(',')
    )
  ].join('\n')
}

type TagInventoryRow = {
  id: number
  name: string
  alias: string[]
  source: string
  introduction: string
  storedCount: number
  actualCount: number
  created: Date
  updated: Date
  samplePatches: string[]
}

export const getTagInventory = async (): Promise<TagInventoryRow[]> => {
  const tags = await prisma.patch_tag.findMany({
    orderBy: [{ count: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      alias: true,
      source: true,
      introduction: true,
      count: true,
      created: true,
      updated: true,
      _count: {
        select: {
          patch_relation: true
        }
      },
      patch_relation: {
        take: 5,
        orderBy: { patch_id: 'asc' },
        select: {
          patch: {
            select: {
              unique_id: true,
              name: true
            }
          }
        }
      }
    }
  })

  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    alias: tag.alias,
    source: tag.source,
    introduction: tag.introduction,
    storedCount: tag.count,
    actualCount: tag._count.patch_relation,
    created: tag.created,
    updated: tag.updated,
    samplePatches: tag.patch_relation.map(
      (relation) => `${relation.patch.unique_id}:${relation.patch.name}`
    )
  }))
}

const run = async () => {
  const format = getArgValue('--format') ?? 'json'
  const out = getArgValue('--out')
  const rows = await getTagInventory()

  const content =
    format === 'csv'
      ? toCsv(rows)
      : `${JSON.stringify({ generatedAt: new Date().toISOString(), tags: rows }, null, 2)}\n`

  if (out) {
    await writeFile(out, content)
    console.log(`Exported ${rows.length} tags to ${out}.`)
  } else {
    process.stdout.write(content)
  }
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
