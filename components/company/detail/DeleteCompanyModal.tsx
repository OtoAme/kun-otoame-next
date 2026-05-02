'use client'

import { useState } from 'react'
import { useRouter } from '@bprogress/next'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { kunFetchDelete } from '~/utils/kunFetch'
import { kunErrorHandler } from '~/utils/kunErrorHandler'
import { useUserStore } from '~/store/userStore'
import type { CompanyDetail } from '~/types/api/company'
import type { FC } from 'react'

interface Props {
  company: CompanyDetail
}

export const DeleteCompanyModal: FC<Props> = ({ company }) => {
  const router = useRouter()
  const user = useUserStore((state) => state.user)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [deleting, setDeleting] = useState(false)

  const handleDeleteCompany = async () => {
    setDeleting(true)
    const res = await kunFetchDelete<KunResponse<{}>>('/company', {
      companyId: company.id
    })

    kunErrorHandler(res, () => {
      onClose()
      router.push('/company')
      toast.success('会社删除成功')
    })
    setDeleting(false)
  }

  return (
    <>
      {user.role > 2 && (
        <Button
          variant="flat"
          color="danger"
          onPress={onOpen}
          startContent={<Trash2 />}
        >
          删除该会社
        </Button>
      )}

      <Modal isOpen={isOpen} onClose={onClose} placement="center">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">删除会社</ModalHeader>
          <ModalBody>
            <p>您确定要删除这个会社吗？该操作不可撤销</p>
            <p className="pl-4 border-l-4 border-primary-500">
              {company.name}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              取消
            </Button>
            <Button
              color="danger"
              onPress={handleDeleteCompany}
              isDisabled={deleting}
              isLoading={deleting}
            >
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
