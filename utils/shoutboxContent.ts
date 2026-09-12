export const normalizeShoutboxContent = (value: string) =>
  value.replace(/\r\n|\r|\n|\u2028|\u2029/g, ' ')
