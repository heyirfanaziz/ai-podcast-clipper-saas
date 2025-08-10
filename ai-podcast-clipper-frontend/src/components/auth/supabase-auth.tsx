'use client'

import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '~/lib/supabase'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'

export function SupabaseAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [redirectUrl, setRedirectUrl] = useState<string>('/dashboard')
  const router = useRouter()

  useEffect(() => {
    // Set the redirect URL once we're on the client side
    if (typeof window !== 'undefined') {
      setRedirectUrl(`${window.location.origin}/dashboard`)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        router.push('/dashboard')
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  if (session) {
    return <div>Loading...</div>
  }

  return (
    <div className="w-full max-w-md">
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        providers={['google', 'github']}
        redirectTo={redirectUrl}
        theme="light"
      />
    </div>
  )
} 