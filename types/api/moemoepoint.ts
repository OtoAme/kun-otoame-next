export const MOEMOEPOINT_LEDGER_KINDS = [
  'opening',
  'earn',
  'spend',
  'reserve',
  'release',
  'forfeit',
  'refund',
  'reversal',
  'adjustment'
] as const

export type MoemoepointLedgerKind = (typeof MOEMOEPOINT_LEDGER_KINDS)[number]

export type MoemoepointReservationStatus = 'pending' | 'released' | 'forfeited'

export interface MoemoepointBalance {
  total: number
  reserved: number
  available: number
}

export interface MoemoepointLedgerEntry {
  id: number
  kind: MoemoepointLedgerKind
  balanceDelta: number
  reservedDelta: number
  availableDelta: number
  balanceAfter: MoemoepointBalance
  reasonCode: string
  reason: string
  referenceType: string | null
  referenceId: string | null
  link: string
  created: string
}

export interface MoemoepointLedgerResponse {
  user: {
    id: number
    name: string
    avatar: string
  }
  balance: MoemoepointBalance
  records: MoemoepointLedgerEntry[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  range: {
    preset: '7d' | '30d' | 'custom'
    start: string
    end: string
  }
}
