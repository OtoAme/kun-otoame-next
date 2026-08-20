import type { MoemoepointBalance } from '~/types/api/moemoepoint'

export const toMoemoepointBalance = (user: {
  moemoepoint: number
  moemoepoint_reserved?: number
}): MoemoepointBalance => {
  const reserved = user.moemoepoint_reserved ?? 0
  return {
    total: user.moemoepoint,
    reserved,
    available: user.moemoepoint - reserved
  }
}
