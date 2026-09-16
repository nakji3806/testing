'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setNotice('')
    const supabase = createClient()
    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/` } })
    setBusy(false)
    if (result.error) return setNotice(result.error.message)
    if (mode === 'signup' && !result.data.session) {
      return setNotice('인증 메일을 보냈어요. 메일의 링크를 눌러 가입을 완료해 주세요.')
    }
    router.replace('/')
    router.refresh()
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">MATHNOTE AI</p>
        <h1>막힌 문제를<br />한 장의 사진으로.</h1>
        <p className="muted">사진을 올리면 풀이 과정을 차근차근 정리해드려요.</p>
        <form onSubmit={submit}>
          <label>이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
          {notice && <p className="notice">{notice}</p>}
          <button className="primary" disabled={busy}>{busy ? '처리 중…' : mode === 'signin' ? '로그인' : '가입하기'}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setNotice('') }}>
          {mode === 'signin' ? '처음이신가요? 가입하기' : '이미 계정이 있나요? 로그인'}
        </button>
      </section>
    </main>
  )
}
