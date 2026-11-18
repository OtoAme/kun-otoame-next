'use client'
import { Button } from '@heroui/button'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import {
  isNotificationEvent,
  NOTIFICATION_EVENTS
} from '~/constants/notification'
import {
  confirmPreferenceConflicts,
  discardPreferenceDrafts,
  refreshPreferences,
  savePreferenceDrafts
} from '~/utils/preferenceClient'
export const PreferenceActions = () => {
  const state = useAccountPreferences()
  const dirty = Object.keys(state.drafts).length > 0
  return (
    <div className="space-y-2" aria-live="polite">
      {state.error && <p role="status">{state.error}</p>}
      {state.conflicts.length > 0 && state.snapshot && (
        <div className="space-y-2">
          <p>
            以下设置已变化：
            {state.conflicts
              .map(
                (key) =>
                  `${key === 'nsfw' ? '内容显示' : key === 'email-notice' ? '邮件通知' : key.startsWith('notification:') && isNotificationEvent(key.slice(13)) ? NOTIFICATION_EVENTS[key.slice(13) as keyof typeof NOTIFICATION_EVENTS].label : '标签 ' + key.slice(12)}（服务器：${({ sfw: '仅 SFW', nsfw: '仅 NSFW', all: '全部内容', true: '开启', false: '关闭' } as Record<string, string>)[String(state.snapshot!.items[key]?.value)] ?? '已变化'}）`
              )
              .join('、')}
          </p>
          <Button size="sm" onPress={discardPreferenceDrafts}>
            使用服务器设置
          </Button>
          <Button size="sm" onPress={confirmPreferenceConflicts}>
            保留我的选择，重新确认
          </Button>
        </div>
      )}
      {dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            color="primary"
            isLoading={state.saving}
            isDisabled={!state.canEdit || state.conflicts.length > 0}
            onPress={() => {
              void savePreferenceDrafts()
            }}
          >
            保存设置
          </Button>
          <Button
            size="sm"
            isDisabled={state.saving}
            onPress={discardPreferenceDrafts}
          >
            放弃草稿
          </Button>
        </div>
      )}
      {state.status === 'error' && (
        <Button
          size="sm"
          onPress={() => {
            void refreshPreferences()
          }}
        >
          重新读取设置
        </Button>
      )}
    </div>
  )
}
