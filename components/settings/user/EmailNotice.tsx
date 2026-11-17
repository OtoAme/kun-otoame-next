'use client'

import { Card, CardBody, CardFooter, CardHeader } from '@heroui/card'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { editPreference } from '~/utils/preferenceClient'
import { PreferenceActions } from './PreferenceActions'
import { Switch } from '@heroui/react'

export const EmailNotice = () => {
  const state = useAccountPreferences()
  const selected = Boolean(
    state.drafts['email-notice']?.value ??
      state.snapshot?.items['email-notice'].value
  )

  return (
    <Card className="w-full text-sm">
      <CardHeader>
        <h2 className="text-xl font-medium">邮件通知</h2>
      </CardHeader>
      <CardBody className="py-0 space-y-4">
        <div>
          <p>当网站有通知时, 会通过邮件的形式提醒您</p>
        </div>
        <div className="flex items-center justify-between">
          <p>是否开启邮件通知</p>
          <Switch
            size="lg"
            color="primary"
            isSelected={selected}
            isDisabled={!state.canEdit}
            onValueChange={(value) => editPreference('email-notice', value)}
          />
        </div>
        <PreferenceActions />
      </CardBody>

      <CardFooter className="flex-wrap">
        <p className="text-default-500">
          您可以开启或关闭邮件通知, 关闭后您将不会收到关于网站的任何邮件
        </p>
      </CardFooter>
    </Card>
  )
}
