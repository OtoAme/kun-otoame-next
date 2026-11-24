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
          <p>接收管理员发送的网站邮件。站内通知通过「站内通知订阅」设置。</p>
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
        <PreferenceActions settingKeys={['email-notice']} />
      </CardBody>

      <CardFooter className="flex-wrap">
        <p className="text-default-500">
          关闭后不接收管理员群发邮件。验证码、密码找回及邮箱变更等账号邮件仍会按操作发送。
        </p>
      </CardFooter>
    </Card>
  )
}
