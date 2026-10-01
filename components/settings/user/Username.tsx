'use client'

import { Card, CardBody, CardFooter, CardHeader } from '@heroui/card'
import { Input } from '@heroui/input'
import { Button } from '@heroui/button'
import { useUserStore } from '~/store/userStore'
import { useRef, useState } from 'react'
import { kunFetchPost } from '~/utils/kunFetch'
import { errorReporter, kunErrorHandler } from '~/utils/kunErrorHandler'
import { usernameSchema } from '~/validations/user'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/modal'
import toast from 'react-hot-toast'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'

export const Username = () => {
  const { user, setUser, setMoemoepointBalance } = useUserStore(
    (state) => state
  )
  const [username, setUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const saving = useRef(false)
  const { isOpen, onOpen, onOpenChange } = useDisclosure()
  const inputValue = username ?? user.name
  const result = usernameSchema.safeParse({ username: inputValue })
  const hasChanges = inputValue.trim() !== user.name.trim()
  const canSave = !!user.uid && hasChanges && result.success && !loading
  const error =
    hasChanges && !result.success ? result.error.errors[0].message : ''

  const handleSave = async () => {
    if (!canSave || !result.success || saving.current) {
      return false
    }
    if (user.moemoepointAvailable < 30) {
      toast.error('更改用户名需要 30 可用萌萌点，您的可用萌萌点不足')
      return false
    }

    saving.current = true
    setLoading(true)
    try {
      const res = await kunFetchPost<
        KunResponse<{ balance: MoemoepointBalance }>
      >('/user/setting/username', result.data)
      kunErrorHandler(res, (value) => {
        setUser({ ...useUserStore.getState().user, name: result.data.username })
        setMoemoepointBalance(value.balance)
        setUsername(null)
        toast.success('更新用户名成功')
      })
      return typeof res !== 'string'
    } catch (error) {
      errorReporter(error)
      return false
    } finally {
      saving.current = false
      setLoading(false)
    }
  }

  return (
    <Card className="w-full text-sm">
      <CardHeader>
        <h2 className="text-xl font-medium">用户名</h2>
      </CardHeader>
      <CardBody className="py-0 space-y-4">
        <div>
          <p>这是您的用户名设置, 您的用户名是唯一的</p>
        </div>
        <Input
          label="用户名"
          autoComplete="text"
          value={inputValue}
          onValueChange={setUsername}
          isDisabled={!user.uid || loading}
          isInvalid={!!error}
          errorMessage={error}
        />
      </CardBody>

      <CardFooter className="flex-wrap">
        <p className="text-default-500">
          用户名长度最大为 17, 可以是任意字符, 更改用户名需要消耗您 30
          可用萌萌点
        </p>

        <Button
          color="primary"
          variant="solid"
          className="ml-auto"
          onPress={onOpen}
          isDisabled={!canSave}
        >
          保存
        </Button>

        <Modal
          isOpen={isOpen}
          onOpenChange={() => {
            if (!saving.current) onOpenChange()
          }}
          isDismissable={!loading}
          isKeyboardDismissDisabled={loading}
          hideCloseButton={loading}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  您确定要更改用户名吗?
                </ModalHeader>
                <ModalBody>
                  <p>更改用户名需要消耗您 30 可用萌萌点, 该操作不可撤销</p>
                </ModalBody>
                <ModalFooter>
                  <Button
                    color="danger"
                    variant="light"
                    onPress={onClose}
                    isDisabled={loading}
                  >
                    关闭
                  </Button>
                  <Button
                    color="primary"
                    onPress={async () => {
                      if (await handleSave()) onClose()
                    }}
                    isLoading={loading}
                    isDisabled={!canSave}
                  >
                    确定
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
      </CardFooter>
    </Card>
  )
}
