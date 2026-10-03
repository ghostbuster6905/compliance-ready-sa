'use client'

import { useState, type SubmitEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const MIN_PASSWORD_LENGTH = 8

type FormValues = {
  fullName: string
  companyName: string
  email: string
  password: string
  confirmPassword: string
}

type FieldErrors = Partial<Record<keyof FormValues, string>>

const initialValues: FormValues = {
  fullName: '',
  companyName: '',
  email: '',
  password: '',
  confirmPassword: '',
}

function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {}

  if (!values.fullName.trim()) errors.fullName = 'Full name is required.'
  if (!values.companyName.trim())
    errors.companyName = 'Company name is required.'

  if (!values.email.trim()) {
    errors.email = 'Email address is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }

  if (!values.password) {
    errors.password = 'Password is required.'
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password.'
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }

  return errors
}

export default function RegisterPage() {
  const router = useRouter()
  const [values, setValues] = useState<FormValues>(initialValues)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    null
  )
  // Set once signUp has returned a session, so a retry after a failed
  // onboarding call does not attempt to create the auth user a second time.
  const [accountCreated, setAccountCreated] = useState(false)

  function updateField(field: keyof FormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  async function onboardCompany(fullName: string, companyName: string) {
    const { error } = await supabase.rpc('create_company_for_user', {
      company_name: companyName,
      full_name: fullName,
    })

    if (error) {
      setFormError(
        `Your account was created, but we couldn't set up your company: ${error.message} Please try again.`
      )
      return false
    }

    return true
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const errors = validate(values)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    const fullName = values.fullName.trim()
    const companyName = values.companyName.trim()
    const email = values.email.trim()

    setLoading(true)

    try {
      if (!accountCreated) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: values.password,
          options: {
            data: { full_name: fullName, company_name: companyName },
          },
        })

        if (error) {
          setFormError(error.message)
          return
        }

        if (!data.session) {
          // Email confirmation is required. Onboarding needs an
          // authenticated user, so it must wait until after confirmation.
          setConfirmationEmail(email)
          return
        }

        setAccountCreated(true)
      }

      const onboarded = await onboardCompany(fullName, companyName)
      if (!onboarded) return

      router.push('/')
    } catch {
      setFormError('Something went wrong. Please check your connection and try again.')
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
          {confirmationEmail ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-600">
                ✉
              </div>
              <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
              <p className="mt-2 text-sm text-slate-500">
                We&apos;ve sent a confirmation link to{' '}
                <span className="font-medium text-slate-900">
                  {confirmationEmail}
                </span>
                . Confirm your email address to activate your account, then
                sign in to finish setting up your company.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-xl font-semibold">Create your account</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Start managing your company&apos;s compliance in one place.
                </p>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <Field
                  id="fullName"
                  label="Full Name"
                  autoComplete="name"
                  value={values.fullName}
                  error={fieldErrors.fullName}
                  disabled={loading || accountCreated}
                  onChange={(v) => updateField('fullName', v)}
                />
                <Field
                  id="companyName"
                  label="Company Name"
                  autoComplete="organization"
                  value={values.companyName}
                  error={fieldErrors.companyName}
                  disabled={loading}
                  onChange={(v) => updateField('companyName', v)}
                />
                <Field
                  id="email"
                  label="Email Address"
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  error={fieldErrors.email}
                  disabled={loading || accountCreated}
                  onChange={(v) => updateField('email', v)}
                />
                <Field
                  id="password"
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                  value={values.password}
                  error={fieldErrors.password}
                  disabled={loading || accountCreated}
                  onChange={(v) => updateField('password', v)}
                />
                <Field
                  id="confirmPassword"
                  label="Confirm Password"
                  type="password"
                  autoComplete="new-password"
                  value={values.confirmPassword}
                  error={fieldErrors.confirmPassword}
                  disabled={loading || accountCreated}
                  onChange={(v) => updateField('confirmPassword', v)}
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
                  {loading
                    ? 'Creating account…'
                    : accountCreated
                      ? 'Retry company setup'
                      : 'Create Account'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-blue-600 hover:text-blue-700"
          >
            Sign in
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
  hint?: string
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
  hint,
  error,
  disabled,
}: FieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

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
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={`block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
        }`}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
