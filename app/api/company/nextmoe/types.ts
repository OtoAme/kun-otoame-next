import { z } from 'zod'

export const NEXTMOE_CATALOG_BASE_URL = 'https://api.nextmoe.dev'
export const NEXTMOE_CATALOG_BATCH_MAX = 100
export const NEXTMOE_COMPANY_VALUE_MAX_LENGTH = 107

const nextmoeRefSchema = z.object({
  source: z.string(),
  external_id: z.string()
})

const nextmoeWorkCompanySchema = z.object({
  object: z.string(),
  id: z.string(),
  display_name: z.string(),
  company_kind: z.string().optional(),
  attribution_role: z.string().optional()
})

const nextmoeWorkSchema = z.object({
  object: z.string(),
  id: z.string(),
  refs: z.array(nextmoeRefSchema).optional(),
  companies: z.array(nextmoeWorkCompanySchema).optional()
})

const nextmoeCompanyAliasSchema = z.object({
  value: z.string(),
  lang: z.string().optional(),
  alias_kind: z.string().optional(),
  is_machine: z.boolean().optional()
})

const nextmoeCompanySchema = z.object({
  object: z.string(),
  id: z.string(),
  display_name: z.string(),
  latin: z.string().nullish(),
  aliases: z.array(nextmoeCompanyAliasSchema).optional()
})

const nextmoeListSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    object: z.literal('list'),
    items: z.array(item),
    missing: z.array(z.string()).optional()
  })

export const nextmoeWorkListSchema = nextmoeListSchema(nextmoeWorkSchema)
export const nextmoeCompanyListSchema = nextmoeListSchema(nextmoeCompanySchema)

export type NextmoeRef = z.infer<typeof nextmoeRefSchema>
export type NextmoeWorkCompany = z.infer<typeof nextmoeWorkCompanySchema>
export type NextmoeWork = z.infer<typeof nextmoeWorkSchema>
export type NextmoeCompanyAlias = z.infer<typeof nextmoeCompanyAliasSchema>
export type NextmoeCompany = z.infer<typeof nextmoeCompanySchema>
export type NextmoeWorkList = z.infer<typeof nextmoeWorkListSchema>
export type NextmoeCompanyList = z.infer<typeof nextmoeCompanyListSchema>

export const nextmoeAliasValues = (company: NextmoeCompany): string[] =>
  [
    company.display_name,
    ...(company.aliases ?? [])
      .filter((alias) => alias.is_machine !== true)
      .map((alias) => alias.value)
  ]
    .map((value) => value.trim())
    .filter(
      (value) =>
        value.length > 0 && value.length <= NEXTMOE_COMPANY_VALUE_MAX_LENGTH
    )
