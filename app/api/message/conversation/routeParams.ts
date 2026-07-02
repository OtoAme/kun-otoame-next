export const parseConversationRouteId = (id: string) => {
  if (!/^[1-9]\d{0,6}$/.test(id)) {
    return null
  }

  return Number(id)
}
