import { z } from 'zod'

export const dismissCompanyMergeSuggestionSchema = z.object({
  id: z.coerce.number().int().min(1).max(9999999)
})
