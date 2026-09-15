'use client'

import { Button, Card, CardBody, Link } from '@heroui/react'

interface Props {
  title: string
  description: string
  showRegister?: boolean
}

/** /issue 服务端页面的未登录兜底展示；HeroUI 组件只能落在 client 边界内。 */
export const IssueLoginRequired = ({
  title,
  description,
  showRegister = false
}: Props) => (
  <div className="container mx-auto my-8">
    <Card className="mx-auto max-w-lg">
      <CardBody className="items-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-medium">{title}</h1>
        <p className="text-default-500">{description}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button as={Link} href="/login" color="primary">
            登录
          </Button>
          {showRegister && (
            <Button as={Link} href="/register" variant="bordered">
              注册账号
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  </div>
)
