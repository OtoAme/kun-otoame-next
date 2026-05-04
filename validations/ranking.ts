import { z } from 'zod'

export const rankingSchema = z.object({
  sortField: z.enum([
    'rating',
    'rating_count',
    'like',
    'favorite',
    'resource',
    'comment',
    'download',
    'view'
  ]),
  sortOrder: z.enum(['asc', 'desc']),
  minRatingCount: z.coerce.number().min(0).max(9999999),
  page: z.coerce.number().min(1).max(9999999),
  limit: z.coerce.number().min(1).max(50)
})
