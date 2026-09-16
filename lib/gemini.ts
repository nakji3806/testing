// Imported by the server route only. Never expose GEMINI_API_KEY to client code.
type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  }>
  promptFeedback?: { blockReason?: string }
}

export class GeminiError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

export async function generateExplanation(input: {
  imageBase64: string
  mimeType: string
  question: string
  systemPrompt: string
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) throw new GeminiError('서버에 GEMINI_API_KEY 환경변수를 설정해 주세요.', 503)
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash'
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new GeminiError('GEMINI_MODEL에 Gemini 모델 ID만 입력해 주세요.', 503)
  }

  let response: Response
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
          { text: input.question ? `이 수학 문제를 풀어주세요. 추가 요청: ${input.question}` : '이 수학 문제를 풀어주세요.' },
        ] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      }),
    })
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
      throw new GeminiError('해설 생성 시간이 초과됐어요. 문제 한 개만 잘라 다시 시도해 주세요.', 504)
    }
    throw new GeminiError('Gemini에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
  // Do not relay upstream bodies: they may contain request or credential details.
  if (!response.ok) {
    if (response.status === 429) throw new GeminiError('Gemini 요청 한도 또는 할당량을 초과했어요. 잠시 후 시도하거나 Google AI Studio에서 할당량을 확인해 주세요.', 429)
    if (response.status === 404) throw new GeminiError('설정된 Gemini 모델을 사용할 수 없습니다. GEMINI_MODEL과 Google AI Studio의 모델 접근 권한을 확인해 주세요.', 503)
    if ([401, 403].includes(response.status)) throw new GeminiError('Gemini API 키 또는 프로젝트 접근 권한을 확인해 주세요.', 503)
    if (response.status === 400) throw new GeminiError('Gemini가 요청을 거절했습니다. 이미지 형식, GEMINI_API_KEY, GEMINI_MODEL 설정을 확인해 주세요.')
    throw new GeminiError('Gemini 서비스 요청에 실패했어요. 잠시 후 다시 시도해 주세요.')
  }
  let body: GeminiResponse
  try { body = await response.json() } catch {
    throw new GeminiError('Gemini 응답을 읽지 못했어요. 다시 시도해 주세요.')
  }
  const candidate = body.candidates?.[0]
  if (body.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(candidate?.finishReason ?? '')) {
    throw new GeminiError('이 이미지의 해설을 생성할 수 없어요. 수학 문제 부분만 잘라 다시 올려 주세요.', 422)
  }
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('풀이가 길어 완성되지 않았어요. 문제를 한 개씩 올려 주세요.', 422)
  }
  const explanation = candidate?.content?.parts
    ?.filter(part => !part.thought && typeof part.text === 'string')
    .map(part => part.text).join('\n').trim()
  if (!explanation || candidate?.finishReason !== 'STOP') {
    throw new GeminiError('완성된 AI 풀이를 받지 못했어요. 더 선명한 사진으로 다시 시도해 주세요.')
  }
  return explanation
}
