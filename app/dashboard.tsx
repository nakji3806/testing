'use client'

import { ChangeEvent, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Solution = { id: string; title: string; explanation: string; image_path: string; created_at: string }

export function Dashboard({ email, initialSolutions }: { email: string; initialSolutions: Solution[] }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Solution | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null
    if (!next) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) return setError('JPG, PNG, WEBP 이미지 파일만 올릴 수 있어요.')
    if (next.size > 4 * 1024 * 1024) return setError('이미지는 4MB 이하로 올려 주세요.')
    setError('')
    setFile(next)
    setPreview(URL.createObjectURL(next))
  }

  async function solve() {
    if (!file) return setError('먼저 수학 문제 사진을 선택해 주세요.')
    setLoading(true); setError('')
    const form = new FormData()
    form.append('image', file)
    form.append('question', question)
    try {
      const response = await fetch('/api/solve', { method: 'POST', body: form })
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(response.status === 413 ? '이미지는 4MB 이하로 올려 주세요.' : '서버 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? '풀이 생성에 실패했습니다.')
      setFile(null); setPreview(null); setQuestion('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '문제가 발생했습니다.')
    } finally { setLoading(false) }
  }

  async function signOut() {
    await createClient().auth.signOut()
    router.replace('/login'); router.refresh()
  }

  return (
    <main className="app-shell">
      <header><div><p className="eyebrow">MATHNOTE AI</p><h1>오늘의 풀이 노트</h1></div><div className="account"><span>{email}</span><button className="text-button" onClick={signOut}>로그아웃</button></div></header>
      <section className="hero"><div><p className="eyebrow">AI MATH COACH</p><h2>문제를 찍어 올리면<br /><em>풀이의 길</em>을 보여드려요.</h2><p>선명한 사진일수록 식과 조건을 더 정확히 읽을 수 있어요.</p></div><div className="hero-orbit">∑</div></section>
      <section className="workspace">
        <div className="upload-panel">
          <h2>새 문제 풀이</h2>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} hidden />
          <button className={`drop-zone ${preview ? 'has-image' : ''}`} onClick={() => inputRef.current?.click()}>
            {preview ? <img src={preview} alt="선택한 문제 미리보기" /> : <><strong>＋</strong><span>문제 사진을 올려주세요</span><small>JPG · PNG · WEBP / 최대 4MB</small></>}
          </button>
          <label className="question-label">추가 요청 (선택)<textarea value={question} maxLength={2000} onChange={(e) => setQuestion(e.target.value)} placeholder="예: 중학교 2학년 수준으로 설명해줘" rows={3} /></label>
          {error && <p className="notice">{error}</p>}
          <button className="primary solve-button" onClick={solve} disabled={loading}>{loading ? 'AI가 풀이를 작성 중…' : 'AI 해설 만들기 →'}</button>
        </div>
        <div className="history-panel"><div className="section-heading"><div><p className="eyebrow">MY ARCHIVE</p><h2>나의 풀이 기록</h2></div><span>{initialSolutions.length}개</span></div>
          <div className="solution-list">{initialSolutions.length === 0 ? <div className="empty">아직 저장된 풀이가 없어요.<br />첫 문제를 올려 시작해 보세요.</div> : initialSolutions.map((solution) => <button className="solution-card" onClick={() => setSelected(solution)} key={solution.id}><span>{new Date(solution.created_at).toLocaleDateString('ko-KR')}</span><strong>{solution.title}</strong><p>{solution.explanation.slice(0, 100)}…</p></button>)}</div>
        </div>
      </section>
      {selected && <SolutionModal solution={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}

function SolutionModal({ solution, onClose }: { solution: Solution; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  async function loadImage() {
    if (loaded) return
    setLoaded(true)
    const { data } = await createClient().storage.from('problem-images').createSignedUrl(solution.image_path, 60 * 10)
    setImageUrl(data?.signedUrl ?? null)
  }
  return <div className="modal-backdrop" onClick={onClose}><article className="modal" onClick={(e) => e.stopPropagation()}><button className="close" onClick={onClose}>×</button><p className="eyebrow">SAVED SOLUTION</p><h2>{solution.title}</h2><p className="modal-date">{new Date(solution.created_at).toLocaleString('ko-KR')}</p><button className="view-image" onClick={loadImage}>원본 문제 사진 보기</button>{imageUrl && <img className="source-image" src={imageUrl} alt="원본 수학 문제" />}<div className="explanation">{solution.explanation}</div></article></div>
}
