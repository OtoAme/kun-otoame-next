import { Prisma } from '@prisma/client'

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** UTC clock text for TIMESTAMP(3) WITHOUT TIME ZONE. No zone suffix. */
export const timestampWithoutZone = (value: Date) =>
  `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`

export const sqlTimestamp = (value: Date) =>
  Prisma.sql`${timestampWithoutZone(value)}::timestamp(3) without time zone`
