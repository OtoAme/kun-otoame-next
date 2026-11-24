import Cookies from 'js-cookie'
import {
  preferenceSnapshotSchema,
  preferenceConflictSchema
} from '~/validations/preferences'
import { useUserStore } from '~/store/userStore'
import { resetPreferences, usePreferenceStore } from '~/store/preferenceStore'
import { useSettingStore } from '~/store/settingStore'
import { KunFetchError, kunFetchGet, kunFetchPatch } from './kunFetch'
import type {
  PreferenceSnapshot,
  PreferenceValue
} from '~/types/api/preferences'

const identity = () => {
  const state = useUserStore.getState()
  return state.sessionStatus === 'authenticated' && state.sessionContext
    ? {
        uid: state.user.uid,
        context: state.sessionContext,
        generation: state.sessionGeneration
      }
    : null
}
const owns = (expected: NonNullable<ReturnType<typeof identity>>) => {
  const current = useUserStore.getState()
  return (
    current.user.uid === expected.uid &&
    current.sessionContext === expected.context &&
    current.sessionGeneration === expected.generation
  )
}
const matches = (expected: NonNullable<ReturnType<typeof identity>>) =>
  useUserStore.getState().sessionStatus === 'authenticated' && owns(expected)
let readSequence = 0
let successfulReadSequence = 0
let saveSequence = 0

const legacyCookie = 'kun-patch-setting-store|state|data|kunNsfwEnable'
const clearLegacy = () => {
  Cookies.remove(legacyCookie, { path: '/' })
  Cookies.remove('kun-patch-setting-store|state|data|kunBlockedTagIds', {
    path: '/'
  })
}
const accept = (
  snapshot: PreferenceSnapshot,
  expected: NonNullable<ReturnType<typeof identity>>
) => {
  snapshot = preferenceSnapshotSchema.parse(snapshot)
  if (
    !matches(expected) ||
    snapshot.uid !== expected.uid ||
    snapshot.context !== expected.context
  )
    return false
  const state = usePreferenceStore.getState()
  if (
    state.generation === expected.generation &&
    state.applied &&
    state.applied.version > snapshot.version
  ) {
    usePreferenceStore.setState({ status: 'ready' })
    return false
  }
  const applied =
    state.applied?.version === snapshot.version &&
    state.generation === expected.generation
      ? { ...snapshot, items: { ...state.applied.items, ...snapshot.items } }
      : snapshot
  usePreferenceStore.setState({
    applied,
    generation: expected.generation,
    status: 'ready'
  })
  useSettingStore.getState().setData({
    kunNsfwEnable: snapshot.items.nsfw.value as string,
    kunBlockedTagIds: snapshot.blockedTagIds
  })
  clearLegacy()
  return true
}
let pending: { key: string; promise: Promise<void> } | null = null
export const refreshPreferences = (tagIds: number[] = []) => {
  const expected = identity()
  if (!expected) return Promise.resolve()
  const state = usePreferenceStore.getState()
  const keys = [
    ...new Set([
      ...tagIds,
      ...Object.keys(state.drafts)
        .filter((key) => key.startsWith('blocked-tag:'))
        .map((key) => Number(key.slice(12)))
    ])
  ].sort((a, b) => a - b)
  if (keys.length > 100) {
    usePreferenceStore.setState({
      error: '请先保存或放弃当前标签草稿后继续选择'
    })
    return Promise.resolve()
  }
  const key = `${expected.context}:${expected.generation}:${keys.join(',')}`
  if (pending?.key === key) return pending.promise
  if (
    state.generation !== expected.generation ||
    state.applied?.context !== expected.context
  )
    resetPreferences()
  const legacy = Cookies.get(legacyCookie)
  if (legacy === 'sfw' || legacy === 'nsfw' || legacy === 'all')
    usePreferenceStore.setState({ legacyNsfw: legacy })
  usePreferenceStore.setState({ status: 'loading', error: null })
  const sequence = ++readSequence
  const promise = kunFetchGet<PreferenceSnapshot>(
    '/user/preferences' +
      (keys.length ? '?' + keys.map((id) => `tagId=${id}`).join('&') : '')
  )
    .then((snapshot) => {
      if (accept(snapshot, expected)) {
        successfulReadSequence = Math.max(successfulReadSequence, sequence)
        usePreferenceStore.setState({ error: null })
      } else if (
        owns(expected) &&
        sequence === readSequence &&
        (!matches(expected) ||
          snapshot.uid !== expected.uid ||
          snapshot.context !== expected.context)
      ) {
        const current = usePreferenceStore.getState()
        usePreferenceStore.setState({
          status: current.applied ? 'ready' : 'error',
          error: '会话待确认，请重新读取设置'
        })
      }
    })
    .catch(() => {
      if (owns(expected) && sequence >= successfulReadSequence)
        usePreferenceStore.setState({
          status: 'error',
          error: '设置读取失败，请重试'
        })
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null
    })
  pending = { key, promise }
  return promise
}
export const observePreferenceVersion = (
  version: number | null | undefined
) => {
  const expected = identity()
  if (!expected) return
  const known =
    Number.isInteger(version) && Number(version) >= 0 ? Number(version) : null
  usePreferenceStore.setState({ observedVersion: known })
  if (version === undefined) return
  const state = usePreferenceStore.getState()
  if (
    !state.applied ||
    state.generation !== expected.generation ||
    (known !== null && known > state.applied.version)
  )
    void refreshPreferences()
}
export const editPreference = (key: string, value: PreferenceValue) => {
  const expected = identity()
  const state = usePreferenceStore.getState()
  if (
    !expected ||
    state.generation !== expected.generation ||
    state.applied?.context !== expected.context ||
    !state.applied.items[key]
  )
    return
  if (!state.drafts[key] && Object.keys(state.drafts).length >= 100) {
    usePreferenceStore.setState({ error: '请先保存或放弃当前草稿后继续选择' })
    return
  }
  const previous = state.drafts[key]
  const draft = previous ?? {
    ...expected,
    key,
    version: state.applied.items[key].version,
    value
  }
  usePreferenceStore.setState({
    drafts: { ...state.drafts, [key]: { ...draft, value } },
    error: null
  })
}
export const discardPreferenceDrafts = () =>
  usePreferenceStore.setState({ drafts: {}, conflicts: [], error: null })
export const confirmPreferenceConflicts = () => {
  const state = usePreferenceStore.getState()
  const drafts = { ...state.drafts }
  for (const key of state.conflicts) {
    if (drafts[key] && state.applied?.items[key])
      drafts[key] = {
        ...drafts[key],
        version: state.applied.items[key].version
      }
  }
  usePreferenceStore.setState({ drafts, conflicts: [], error: null })
}
export const savePreferenceDrafts = async () => {
  const state = usePreferenceStore.getState()
  const expected = identity()
  const drafts = Object.values(state.drafts)
  if (state.saving || !drafts.length) return false
  if (
    !expected ||
    drafts.some(
      (draft) =>
        draft.uid !== expected.uid ||
        draft.context !== expected.context ||
        draft.generation !== expected.generation
    )
  ) {
    usePreferenceStore.setState({
      error: '登录账号或会话已变化，请重新确认设置'
    })
    return false
  }
  const sequence = ++saveSequence
  usePreferenceStore.setState({ saving: true, error: null })
  try {
    const snapshot = await kunFetchPatch<PreferenceSnapshot>(
      '/user/preferences',
      {
        uid: drafts[0].uid,
        context: drafts[0].context,
        changes: drafts.map(({ key, value, version }) => ({
          key,
          value,
          version
        }))
      }
    )
    if (!accept(snapshot, expected)) {
      if (owns(expected))
        usePreferenceStore.setState({
          error: '会话待确认，保存结果尚未应用；确认后请重新读取或手动保存'
        })
      return false
    }
    const latest = { ...usePreferenceStore.getState().drafts }
    for (const draft of drafts)
      if (latest[draft.key] === state.drafts[draft.key])
        delete latest[draft.key]
    usePreferenceStore.setState({
      drafts: latest,
      conflicts: [],
      legacyNsfw: null
    })
    try {
      window.localStorage.setItem(
        'kun-preference-change',
        JSON.stringify({
          uid: expected.uid,
          version: snapshot.version,
          nonce: Math.random()
        })
      )
    } catch {}
    return true
  } catch (error) {
    if (!owns(expected)) return false
    if (!matches(expected)) {
      usePreferenceStore.setState({
        error: '会话待确认，草稿已保留；确认后请手动保存'
      })
      return false
    }
    if (
      error instanceof KunFetchError &&
      error.status === 409 &&
      error.body &&
      typeof error.body === 'object' &&
      'code' in error.body &&
      error.body.code === 'PREFERENCE_CONFLICT'
    ) {
      const parsed = preferenceConflictSchema.safeParse(error.body)
      if (!parsed.success) {
        usePreferenceStore.setState({
          error: '服务器设置结果不完整，请重新读取；草稿已保留'
        })
        return false
      }
      const conflict = parsed.data
      if (accept(conflict.snapshot, expected))
        usePreferenceStore.setState({
          conflicts: conflict.conflicts,
          error: conflict.message
        })
    } else {
      usePreferenceStore.setState({
        error:
          error instanceof KunFetchError && error.status === 409
            ? '账号、会话或标签已变化，请重新读取后确认'
            : '保存失败，草稿已保留；恢复连接后请手动保存'
      })
    }
    return false
  } finally {
    if (owns(expected) && sequence === saveSequence)
      usePreferenceStore.setState({ saving: false })
  }
}
