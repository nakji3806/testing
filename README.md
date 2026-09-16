# Mathnote AI

사진으로 수학 문제를 올리면 Gemini가 이미지를 읽고 한국어 풀이를 작성하며, Supabase에 사용자별 기록을 저장하는 Next.js 앱입니다.

## 1. Supabase 설정

1. Supabase Dashboard에서 **New project**를 만듭니다. Organization은 `testing`을 선택하세요.
2. 프로젝트의 SQL Editor에서 [`supabase/schema.sql`](./supabase/schema.sql)을 실행합니다.
3. Authentication → Providers → Email에서 Email provider를 켭니다. 개발 중 이메일 인증을 생략하려면 **Confirm email**을 끌 수 있습니다.
4. Authentication → URL Configuration의 Site URL에 배포 주소를 등록합니다.

## 2. 환경 변수

`.env.example`을 참고해 로컬 `.env.local`과 Vercel Project → Settings → Environment Variables에 아래 3개를 추가합니다. 값은 절대 소스 코드에 넣지 않습니다.

| 이름 | 값 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase의 Publishable key |
| `GEMINI_API_KEY` | Google AI Studio에서 발급한 Gemini API 키 (필수, 서버 전용) |
| `GEMINI_MODEL` | 선택 사항. 기본값 `gemini-2.5-flash` |

[Google AI Studio](https://aistudio.google.com/apikey)에서 키를 발급하고 Vercel에 등록한 뒤 다시 배포하세요. 기존 Supabase 환경변수는 유지합니다. `GROQ_API_KEY`, `GROQ_VISION_MODEL`은 더 이상 사용하지 않아 삭제해도 됩니다. 키 이름에 `NEXT_PUBLIC_`를 붙이지 마세요.

기본 모델은 이미지 입력을 지원하는 [Gemini 2.5 Flash 안정 버전](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash)입니다. 실제 계정의 모델 접근 권한과 할당량은 Google AI Studio에서 확인하세요. 이미지 인식과 풀이 모두 Gemini로 처리하므로 Groq 키는 필요 없습니다.

## 3. 실행 및 배포

```bash
npm install
npm run dev
```

GitHub에 올린 뒤 Vercel에서 저장소를 Import하면 Next.js로 자동 인식합니다. 환경 변수를 먼저 넣고 Deploy하세요.

Gemini 키는 `/api/solve` 서버 라우트에서만 읽습니다. 브라우저 번들에는 포함되지 않습니다. 원본 문제 사진은 비공개 Supabase Storage에 저장되고, RLS 정책이 다른 사용자의 데이터 접근을 차단합니다.

업로드는 JPG/PNG/WEBP, 최대 4MB입니다. 이는 Vercel 함수의 요청 본문 제한(4.5MB) 아래로 유지하기 위한 설정입니다. 해설 생성은 45초에 시간 초과 처리하며, 차단되거나 출력 한도로 잘린 응답은 풀이 기록에 저장하지 않습니다.

## 4. 검증

Node.js 22.18 이상에서 `node --test tests/gemini.test.mjs`로 API 요청 형식, 오류 및 불완전 응답 처리를 검사할 수 있습니다. 이 테스트는 모의 응답을 사용합니다. 실제 키를 등록한 배포에서는 로그인 → 사진 업로드 → 풀이 생성 → 기록 재열기까지 별도로 확인하세요.
