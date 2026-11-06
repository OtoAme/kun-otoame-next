import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-80 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-medium">页面不存在</h1>
      <p>链接可能已失效，也可能是地址输入有误。</p>
      <Link href="/" className="text-primary underline">
        返回首页
      </Link>
    </main>
  )
}
