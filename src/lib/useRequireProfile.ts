'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export type Profile = {
  id: string
  company_id: string
  full_name: string
  role: string
}

export type RequireProfileState =
  | { status: 'loading' }
  | { status: 'error'; title: string; message: string }
  | { status: 'ready'; profile: Profile }

/**
 * Verifies the Supabase session and loads the signed-in user's profile.
 * Redirects to /login when there is no valid session, including when the
 * user signs out in another tab.
 */
export function useRequireProfile(): RequireProfileState {
  const router = useRouter()
  const [state, setState] = useState<RequireProfileState>({
    status: 'loading',
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession()
      if (cancelled) return

      if (sessionError) {
        setState({
          status: 'error',
          title: "We couldn't verify your session",
          message: 'Please refresh the page or sign in again.',
        })
        return
      }

      if (!sessionData.session) {
        router.replace('/login')
        return
      }

      // getSession only reads local storage; getUser confirms the session
      // with Supabase Auth so a revoked or expired session is rejected.
      const { data: userData, error: userError } =
        await supabase.auth.getUser()
      if (cancelled) return

      if (userError || !userData.user) {
        const status = userError?.status ?? 401
        if (status >= 400 && status < 500) {
          router.replace('/login')
          return
        }
        setState({
          status: 'error',
          title: "We couldn't verify your session",
          message: 'Please check your connection and refresh the page.',
        })
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, company_id, full_name, role')
        .eq('id', userData.user.id)
        .maybeSingle<Profile>()
      if (cancelled) return

      if (profileError) {
        setState({
          status: 'error',
          title: "We couldn't load your profile",
          message: 'Please refresh the page or try again shortly.',
        })
        return
      }

      if (!profile) {
        setState({
          status: 'error',
          title: 'Account setup incomplete',
          message:
            "Your account isn't linked to a company yet. Sign out and sign in again to finish setting up your company, or contact support if this continues.",
        })
        return
      }

      setState({ status: 'ready', profile })
    }

    load()

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/login')
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [router])

  return state
}
