import type { z } from 'zod'
import type {
  patchRatingCreateSchema,
  patchRatingUpdateSchema
} from '~/validations/patch'

export interface KunPatchRating {
  id: number
  uniqueId: string
  recommend: string
  overall: number
  playStatus: string
  shortSummary: string
  spoilerLevel: string
  isLike: boolean
  likeCount: number
  userId: number
  patchId: number
  created: Date | string
  updated: Date | string
  user: KunUser
}

export type KunPatchRatingInput = z.infer<typeof patchRatingCreateSchema>

export type KunPatchRatingUpdateInput = z.infer<typeof patchRatingUpdateSchema>

export interface KunPatchRatingResponse {
  ratings: KunPatchRating[]
  total: number
}
