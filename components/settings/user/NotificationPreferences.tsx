'use client'

import { Card, CardBody, CardHeader } from '@heroui/card'
import { Switch } from '@heroui/react'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_SUBSCRIPTIONS
} from '~/constants/notification'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { editPreference } from '~/utils/preferenceClient'
import { PreferenceActions } from './PreferenceActions'

const subscriptionGroups = NOTIFICATION_CATEGORIES.map((category) => ({
  category,
  events: Object.entries(NOTIFICATION_EVENTS).filter(
    ([, event]) => event.optional && event.category === category
  )
})).filter(({ events }) => events.length > 0)

export const NotificationPreferences = () => {
  const state = useAccountPreferences()
  return (
    <Card className="w-full text-sm">
      <CardHeader>
        <h2 className="text-xl font-medium">站内通知订阅</h2>
      </CardHeader>
      <CardBody className="space-y-6">
        <p>
          关闭可选提醒只影响之后的站内通知，历史消息继续保留。关注关系、事项责任、邮件通知及私信接收权限分别管理。
        </p>
        {subscriptionGroups.map(({ category, events }) => (
          <fieldset key={category} className="space-y-3">
            <legend className="mb-2 font-semibold">
              {NOTIFICATION_CATEGORY_LABELS[category]}
            </legend>
            {events.map(([event, definition]) => {
              const key = `notification:${event}`
              return (
                <div
                  key={event}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{definition.label}</span>
                  <Switch
                    aria-label={definition.label}
                    isDisabled={!state.canEdit}
                    isSelected={Boolean(
                      state.drafts[key]?.value ??
                        state.snapshot?.items[key]?.value
                    )}
                    onValueChange={(value) => editPreference(key, value)}
                  />
                </div>
              )
            })}
          </fieldset>
        ))}
        <PreferenceActions settingKeys={NOTIFICATION_SUBSCRIPTIONS} />
      </CardBody>
    </Card>
  )
}
