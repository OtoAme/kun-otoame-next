export type PublisherGrouped<T> = {
  official: T[]
  community: T[]
}

/** 官方与社区只看发布者角色。备份、交接和合并都不改变分组。 */
export const partitionByPublisherRole = <
  T extends { user?: { role?: number } }
>(
  resources: readonly T[]
): PublisherGrouped<T> => {
  const official: T[] = []
  const community: T[] = []
  for (const resource of resources) {
    if ((resource.user?.role ?? 0) > 2) official.push(resource)
    else community.push(resource)
  }
  return { official, community }
}
