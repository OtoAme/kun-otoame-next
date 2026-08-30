export interface VndbCompanyProducer {
  id?: string
  name?: string
  original?: string | null
  aliases?: string[] | null
  lang?: string | null
  type?: string | null
  description?: string | null
  extlinks?: { url?: string | null }[] | null
}

export interface VndbDetailsResponse {
  titles: string[]
  released: string
  tags: string[]
  developers: string[]
  producers: VndbCompanyProducer[]
}

export interface BangumiCompanyReference {
  name: string
  sourceRole: string
}

export interface BangumiDetailsResponse {
  name: string
  nameCn: string
  summary: string
  tags: string[]
  developers: string[]
  companyReferences: BangumiCompanyReference[]
}

export interface SteamDeveloperReference {
  name: string
  link: string
}

export interface SteamDetailsResponse {
  name: string
  aliases: {
    english?: string
    japanese?: string
    tchinese?: string
  }
  releaseDate: string
  tags: string[]
  developers: SteamDeveloperReference[]
}

export interface DlsiteDetailsResponse {
  rj_code: string
  title_default: string
  title_jp?: string
  title_en?: string
  release_date?: string
  tags?: string
  circle_name?: string
  circle_link?: string
}
