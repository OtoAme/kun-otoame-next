export type NsfwMode = 'sfw' | 'nsfw' | 'all'
export type PreferenceValue = boolean | NsfwMode
export interface PreferenceItem {
  value: PreferenceValue
  version: number
}
export interface PreferenceSnapshot {
  uid: number
  context: string
  version: number
  nsfwSelected: boolean
  blockedTagIds: number[]
  items: Record<string, PreferenceItem>
}
export interface PreferenceChange {
  key: string
  value: PreferenceValue
  version: number
}
export interface PreferenceSave {
  uid: number
  context: string
  changes: PreferenceChange[]
}
export interface PreferenceConflict {
  code: 'PREFERENCE_CONFLICT'
  message: string
  conflicts: string[]
  snapshot: PreferenceSnapshot
}
