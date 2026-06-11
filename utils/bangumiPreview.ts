export interface BangumiTitlePreview {
  name: string
  nameCn: string
}

export const getBangumiPreferredTitle = (preview: BangumiTitlePreview) =>
  preview.nameCn.trim() || preview.name.trim()

export const removeTitleFromAliases = (aliases: string[], title: string) =>
  aliases.filter((alias) => alias !== title)
