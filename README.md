# Mathnote AI

사진으로 수학 문제를 올리면 Groq Vision AI가 한국어 풀이를 작성하고, Supabase에 사용자별 기록을 저장하는 Next.js 앱입니다.

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
| `GROQ_API_KEY` | Groq API Key (서버 전용) |
| `GROQ_VISION_MODEL` | 선택 사항. 기본값 `qwen/qwen3.6-27b` |

## 3. 실행 및 배포

```bash
npm install
npm run dev
```

GitHub에 올린 뒤 Vercel에서 저장소를 Import하면 Next.js로 자동 인식합니다. 환경 변수를 먼저 넣고 Deploy하세요.

Groq 키는 `/api/solve` 서버 라우트에서만 읽습니다. 브라우저 번들에는 포함되지 않습니다. 원본 문제 사진은 비공개 Supabase Storage에 저장되고, RLS 정책이 다른 사용자의 데이터 접근을 차단합니다.
