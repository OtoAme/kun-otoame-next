export const PUBLISHED_PATCH_RESOURCE_STATUS = 0

export type PatchResourceAttributeSource = {
  type: string[]
  language: string[]
  platform: string[]
}

export const patchResourceAttributeSelect = {
  type: true,
  language: true,
  platform: true
} as const

export const visiblePatchResourceWhere = {
  status: PUBLISHED_PATCH_RESOURCE_STATUS
} as const

export const visiblePatchResourceCountSelect = {
  where: visiblePatchResourceWhere
} as const

export const createVisiblePatchResourceWhere = <TWhere extends object>(
  where: TWhere
) => ({
  ...where,
  status: PUBLISHED_PATCH_RESOURCE_STATUS
})

export const buildPatchResourceAttributes = (
  resources: PatchResourceAttributeSource[]
) => {
  const type = new Set<string>()
  const language = new Set<string>()
  const platform = new Set<string>()

  for (const resource of resources) {
    resource.type.forEach((item) => type.add(item))
    resource.language.forEach((item) => language.add(item))
    resource.platform.forEach((item) => platform.add(item))
  }

  return {
    type: Array.from(type),
    language: Array.from(language),
    platform: Array.from(platform)
  }
}
