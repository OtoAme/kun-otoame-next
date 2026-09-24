const HAN_OR_KANA = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u

const hasHanOrKana = (value: string) => HAN_OR_KANA.test(value)

const clean = (value: string | null | undefined) => value?.trim() ?? ''

export const selectLegacyVndbCompanyNames = (input: {
  name?: string | null
  original?: string | null
  aliases?: readonly (string | null | undefined)[] | null
}): { name: string; alias: string[] } | null => {
  const name = clean(input.name)
  if (!name) return null

  const original = clean(input.original)
  const primary =
    !hasHanOrKana(name) && original && hasHanOrKana(original) ? original : name
  const alias = [
    ...(primary === original && name !== primary ? [name] : []),
    ...(primary === name && original && original !== primary ? [original] : []),
    ...(input.aliases ?? []).map((alias) => clean(alias))
  ].filter((alias) => alias && alias !== primary)

  return { name: primary, alias: [...new Set(alias)] }
}
