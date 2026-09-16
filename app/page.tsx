import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Dashboard } from './dashboard'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: solutions } = await supabase
    .from('solutions')
    .select('id, title, explanation, image_path, created_at')
    .order('created_at', { ascending: false })
    .limit(30)

  return <Dashboard email={user.email ?? ''} initialSolutions={solutions ?? []} />
}
