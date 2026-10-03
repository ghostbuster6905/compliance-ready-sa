'use client'

import { useState, type SubmitEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type FormValues = {
  email: string
  password: string
}

type FieldErrors = Partial<Record<keyof FormValues, string>>

type Notice = {
  tone: 'error' | 'warning'
  title?: string
  message: string
}

const initialValues: FormValues = {
  email: '',
  password: '',
}

function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {}

  if (!values.email.trim()) {
    errors.email = 'Email address is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }

  if (!values.password) errors.password = 'Password is required.'

  return errors
}

function readMetadataString(user: User, key: string): string | null {
  const value: unknown = user.user_metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export default function LoginPage() {
  const router = useRouter()
  const [values, setValues] = useState<FormValues>(initialValues)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Signing in…')

  function updateField(field: keyof FormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  // Returns true when the user has a profile (existing or newly created)
  // and can continue to the dashboard.
  async function ensureOnboarded(user: User): Promise<boolean> {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      setNotice({
        tone: 'error',
        message: `You're signed in, but we couldn't load your profile: ${profileError.message}`,
      })
      return false
    }

    if (profile) return true

    // No profile yet: typically a user who confirmed their email after
    // registering. Finish onboarding with the details saved at sign-up.
    const fullName = readMetadataString(user, 'full_name')
    const companyName = readMetadataString(user, 'company_name')

    if (!fullName || !companyName) {
      setNotice({
        tone: 'warning',
        title: 'Account setup incomplete',
        message:
          "You're signed in, but your account isn't linked to a company yet and we don't have the details needed to set one up. Please contact support to complete your account setup.",
      })
      return false
    }

    setStatus('Setting up your company…')
    const { error: rpcError } = await supabase.rpc('create_company_for_user', {
      company_name: companyName,
      full_name: fullName,
    })

    if (rpcError) {
      setNotice({
        tone: 'error',
        message: `You're signed in, but we couldn't finish setting up your company: ${rpcError.message} Please try signing in again.`,
      })
      return false
    }

    return true
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)

    const errors = validate(values)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setStatus('Signing in…')
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      })

      if (error) {
        setNotice({
          tone: 'error',
          message:
            error.code === 'email_not_confirmed'
              ? 'Please confirm your email address before signing in. Check your inbox for the confirmation link.'
              : error.message,
        })
        return
      }

      const onboarded = await ensureOnboarded(data.user)
      if (!onboarded) return

      router.push('/')
    } catch {
      setNotice({
        tone: 'error',
        message: 'Something went wrong. Please check your connection and try again.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 text-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-tight">
            Compliance<span className="text-blue-600">Ready</span>
          </div>
          <div className="text-xs tracking-widest text-slate-400">
            SOUTH AFRICA
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500">
              Welcome back. Sign in to manage your compliance.
            </p>
          </div>

          {notice && (
            <div
              role="alert"
              className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
                notice.tone === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {notice.title && (
                <p className="mb-1 font-semibold">{notice.title}</p>
              )}
              <p>{notice.message}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <Field
              id="email"
              label="Email Address"
              type="email"
              autoComplete="email"
              value={values.email}
              error={fieldErrors.email}
              disabled={loading}
              onChange={(v) => updateField('email', v)}
            />
            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={values.password}
              error={fieldErrors.password}
              disabled={loading}
              onChange={(v) => updateField('password', v)}
            />

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              )}
              {loading ? status : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-blue-600 hover:text-blue-700"
          >
            Create account
          </Link>
        </p>
      </div>
    </main>
  )
}

type FieldProps = {
  id: keyof FormValues
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete?: string
  error?: string
  disabled?: boolean
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  error,
  disabled,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
