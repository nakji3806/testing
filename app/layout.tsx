import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mathnote AI',
  description: '사진으로 푸는 나만의 수학 노트',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
