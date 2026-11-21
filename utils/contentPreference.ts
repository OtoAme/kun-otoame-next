export const getContentLimitWhere = (value?: string) => {
  if (value === 'all') {
    return {}
  }
  return { content_limit: value === 'nsfw' ? 'nsfw' : 'sfw' }
}
