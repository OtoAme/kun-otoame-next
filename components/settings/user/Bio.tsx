'use client'

import { Card, CardBody, CardFooter, CardHeader } from '@heroui/card'
import { Textarea } from '@heroui/input'
import { Button } from '@heroui/button'
import { useUserStore } from '~/store/userStore'
import { useRef, useState } from 'react'
import { kunFetchPost } from '~/utils/kunFetch'
import { bioSchema } from '~/validations/user'
import { errorReporter, kunErrorHandler } from '~/utils/kunErrorHandler'
import toast from 'react-hot-toast'

export const Bio = () => {
  const { user, setUser } = useUserStore((state) => state)
  const [bio, setBio] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const saving = useRef(false)
  const inputValue = bio ?? user.bio
  const result = bioSchema.safeParse({ bio: inputValue })
  const hasChanges = inputValue.trim() !== user.bio.trim()
  const canSave = !!user.uid && hasChanges && result.success && !loading
  const error =
    hasChanges && !result.success ? result.error.errors[0].message : ''

  const handleSave = async () => {
    if (!canSave || !result.success || saving.current) {
      return
    }

    saving.current = true
    setLoading(true)
    try {
      const res = await kunFetchPost<KunResponse<{}>>(
        '/user/setting/bio',
        result.data
      )
      kunErrorHandler(res, () => {
        setUser({ ...useUserStore.getState().user, bio: result.data.bio })
        setBio(null)
        toast.success('更新签名成功')
      })
    } catch (error) {
      errorReporter(error)
    } finally {
      saving.current = false
      setLoading(false)
    }
  }

  return (
    <Card className="w-full text-sm">
      <CardHeader>
        <h2 className="text-xl font-medium">签名</h2>
      </CardHeader>
      <CardBody className="py-0 space-y-4">
        <div>
          <p>这是您的签名设置, 您的签名将会被显示在您的主页上</p>
        </div>
        <Textarea
          label="签名"
          autoComplete="text"
          value={inputValue}
          onValueChange={setBio}
          isDisabled={!user.uid || loading}
          isInvalid={!!error}
          errorMessage={error}
        />
      </CardBody>

      <CardFooter className="flex-wrap">
        <p className="text-default-500">签名最大长度为 107, 可以是任意字符</p>

        <Button
          color="primary"
          variant="solid"
          className="ml-auto"
          onPress={handleSave}
          isLoading={loading}
          isDisabled={!canSave}
        >
          保存
        </Button>
      </CardFooter>
    </Card>
  )
}
