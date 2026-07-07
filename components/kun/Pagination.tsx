'use client'

import { useEffect, useState } from 'react'
import { Button, Input } from '@heroui/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { kunScrollToTop } from '~/utils/scrollToTop'
import type { KeyboardEvent } from 'react'

interface Props {
  total: number
  page: number
  onPageChange: (page: number) => void
  isLoading?: boolean
  disableScrollToTop?: boolean
}

export const KunPagination = ({
  total,
  onPageChange,
  page,
  isLoading = false,
  disableScrollToTop = false
}: Props) => {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState(String(page))

  useEffect(() => {
    setInputValue(String(page))
  }, [page])

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= total) {
      setInputValue(String(newPage))
      if (newPage === page) {
        return
      }
      onPageChange(newPage)
      if (!disableScrollToTop) {
        kunScrollToTop()
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const newPage = parseInt(inputValue)
      if (!isNaN(newPage) && newPage >= 1 && newPage <= total) {
        handlePageChange(newPage)
        setIsEditing(false)
      }
    } else if (e.key === 'Escape') {
      setInputValue(String(page))
      setIsEditing(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-2 p-2 rounded-2xl">
      <Button
        isIconOnly
        aria-label="上一页"
        variant="light"
        color="primary"
        onPress={() => handlePageChange(page - 1)}
        isDisabled={page <= 1 || isLoading}
        isLoading={isLoading}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      <div className="flex items-center min-w-[90px] justify-center px-2">
        {isEditing ? (
          <>
            <Input
              type="number"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                setInputValue(String(page))
                setIsEditing(false)
              }}
              className="w-20"
              min={1}
              max={total}
              autoFocus
            />{' '}
            / {total}
          </>
        ) : (
          <Button onPress={() => setIsEditing(true)} variant="bordered">
            {page} / {total}
          </Button>
        )}
      </div>

      <Button
        isIconOnly
        aria-label="下一页"
        variant="light"
        color="primary"
        onPress={() => handlePageChange(page + 1)}
        isDisabled={page >= total || isLoading}
        isLoading={isLoading}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
