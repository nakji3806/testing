import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateExplanation, GeminiError } from '@/lib/gemini'

export const runtime = 'nodejs'
export const maxDuration = 60

const SYSTEM_PROMPT = `당신은 친절하고 정확한 한국어 수학 선생님입니다. 이미지 속 수학 문제를 읽고 풀이를 작성하세요. 반드시 다음 순서로 답합니다:\n1. 문제 정리\n2. 핵심 개념\n3. 단계별 풀이 (식을 생략하지 말 것)\n4. 최종 답\n\n이미지가 흐리거나 필요한 정보가 없으면 추측하지 말고 어떤 부분이 보이지 않는지 말하세요. 답변은 Markdown으로 작성하세요.`

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const form = await request.formData()
    const image = form.get('image')
    const question = String(form.get('question') ?? '')
    if (!(image instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size === 0) return NextResponse.json({ error: 'JPG, PNG, WEBP 이미지 파일을 올려 주세요.' }, { status: 400 })
    if (image.size > 4 * 1024 * 1024) return NextResponse.json({ error: '이미지는 4MB 이하여야 합니다.' }, { status: 413 })
    if (question.length > 2000) return NextResponse.json({ error: '추가 요청은 2,000자 이내로 입력해 주세요.' }, { status: 400 })

    const bytes = Buffer.from(await image.arrayBuffer())
    const explanation = await generateExplanation({
      imageBase64: bytes.toString('base64'),
      mimeType: image.type,
      question,
      systemPrompt: SYSTEM_PROMPT,
    })

    const extension = image.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg'
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('problem-images').upload(path, bytes, { contentType: image.type, upsert: false })
    if (uploadError) throw uploadError
    const title = question.trim().slice(0, 80) || '수학 문제 풀이'
    const { error: dbError } = await supabase.from('solutions').insert({ user_id: user.id, title, explanation, image_path: path })
    if (dbError) {
      await supabase.storage.from('problem-images').remove([path])
      throw dbError
    }
    return NextResponse.json({ explanation })
  } catch (error) {
    if (error instanceof GeminiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('Solve route error:', error)
    return NextResponse.json({ error: '풀이 저장 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
