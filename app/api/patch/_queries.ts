import { prisma } from '~/prisma/index'

const patchUserSelect = {
  id: true,
  name: true,
  avatar: true
} as const

const patchAliasSelect = {
  name: true
} as const

const patchCountSelect = {
  favorite_folder: true,
  resource: true,
  comment: true
} as const

const patchTagNameSelect = {
  tag: {
    select: {
      name: true
    }
  }
} as const

const patchTagDetailSelect = {
  tag: {
    select: {
      id: true,
      name: true,
      count: true,
      alias: true
    }
  }
} as const

const patchCompanyDetailSelect = {
  company: {
    select: {
      id: true,
      name: true,
      count: true,
      alias: true
    }
  }
} as const

const patchImageSelect = {
  id: true,
  url: true,
  is_nsfw: true
} as const

const patchSummarySelect = {
  id: true,
  unique_id: true,
  vndb_id: true,
  vndb_relation_id: true,
  bangumi_id: true,
  steam_id: true,
  dlsite_code: true,
  name: true,
  introduction: true,
  banner: true,
  status: true,
  view: true,
  download: true,
  type: true,
  language: true,
  platform: true,
  content_limit: true,
  created: true,
  updated: true,
  user: {
    select: patchUserSelect
  },
  tag: {
    select: patchTagNameSelect
  },
  alias: {
    select: patchAliasSelect
  },
  rating_stat: true,
  _count: {
    select: patchCountSelect
  }
} as const

const patchIntroductionSelect = {
  vndb_id: true,
  vndb_relation_id: true,
  bangumi_id: true,
  steam_id: true,
  dlsite_code: true,
  introduction: true,
  official_url: true,
  released: true,
  created: true,
  updated: true,
  resource_update_time: true,
  alias: {
    select: patchAliasSelect
  },
  tag: {
    select: patchTagDetailSelect
  },
  company: {
    select: patchCompanyDetailSelect
  },
  images: {
    select: patchImageSelect,
    orderBy: {
      display_order: 'asc' as const
    }
  }
} as const

const patchPageSelect = {
  ...patchSummarySelect,
  ...patchIntroductionSelect,
  tag: {
    select: patchTagDetailSelect
  }
} as const

export const getPatchSummaryByUniqueId = async (uniqueId: string) =>
  prisma.patch.findUnique({
    where: { unique_id: uniqueId },
    select: patchSummarySelect
  })

export const getPatchIntroductionContentByUniqueId = async (uniqueId: string) =>
  prisma.patch.findUnique({
    where: { unique_id: uniqueId },
    select: patchIntroductionSelect
  })

export const getPatchPageContentByUniqueId = async (uniqueId: string) =>
  prisma.patch.findUnique({
    where: { unique_id: uniqueId },
    select: patchPageSelect
  })
