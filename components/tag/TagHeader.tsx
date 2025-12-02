'use client'

import { useState } from 'react'
import { Button } from '@heroui/button'
import { useDisclosure } from '@heroui/modal'
import { Plus, Trash2 } from 'lucide-react'
import { CreateTagModal } from '~/components/tag/CreateTagModal'
import { KunHeader } from '../kun/Header'
import { useUserStore } from '~/store/userStore'
import { kunFetchDelete } from '~/utils/kunFetch'
import toast from 'react-hot-toast'
import type { Tag as TagType } from '~/types/api/tag'

interface Props {
  setNewTag: (tag: TagType) => void
  onRefresh: () => void
}

export const TagHeader = ({ setNewTag, onRefresh }: Props) => {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const user = useUserStore((state) => state.user)
  const [clearing, setClearing] = useState(false)

  const handleClearEmpty = async () => {
    if (clearing) return
    setClearing(true)
    try {
      const res = await kunFetchDelete<{ count: number }>('/tag/clear-empty')
      toast.success(`成功清理 ${res.count} 个空标签`)
      onRefresh()
    } catch (e) {
      toast.error('清理失败')
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <KunHeader
        name="标签列表"
        description="这里是本站 OtomeGame 中的所有标签"
        headerEndContent={
          <>
            {user.role > 2 && (
              <div className="flex gap-2">
                <Button
                  color="danger"
                  variant="flat"
                  onPress={handleClearEmpty}
                  isLoading={clearing}
                  startContent={!clearing && <Trash2 size={18} />}
                >
                  清除空标签
                </Button>
                <Button
                  color="primary"
                  onPress={onOpen}
                  startContent={<Plus />}
                >
                  创建标签
                </Button>
              </div>
            )}
          </>
        }
      />

      <CreateTagModal
        isOpen={isOpen}
        onClose={onClose}
        onSuccess={(newTag) => {
          setNewTag(newTag)
          onClose()
        }}
      />
    </>
  )
}
