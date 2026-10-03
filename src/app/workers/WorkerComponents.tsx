'use client'

import { useEffect, useState, type ReactNode, type SubmitEvent } from 'react'
import Link from 'next/link'
import {
  createWorker,
  updateWorker,
  validateWorkerForm,
  workerStatusLabels,
  type Worker,
  type WorkerFormErrors,
  type WorkerFormValues,
  type WorkerStatus,
} from '@/lib/workers'

const TRADE_SUGGESTIONS = [
  'Boilermaker',
  'Bricklayer',
  'Carpenter',
  'Electrician',
  'General Worker',
  'Painter',
  'Plumber',
  'Rigger',
  'Safety Officer',
  'Scaffolder',
  'Site Supervisor',
  'Welder',
]

const statusBadgeClasses: Record<WorkerStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-600',
}

export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <>
      <div
        className={`${size === 'lg' ? 'text-2xl' : 'text-xl'} font-bold tracking-tight`}
      >
        Compliance<span className="text-blue-600">Ready</span>
      </div>
      <div
        className={`text-xs text-slate-400 ${size === 'lg' ? 'tracking-widest' : ''}`}
      >
        SOUTH AFRICA
      </div>
    </>
  )
}

export function AppHeader() {
  return (
    <header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-6 lg:px-8">
      <Link href="/" className="block">
        <Brand />
      </Link>

      <Link
        href="/"
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      >
        ← Back to Dashboard
      </Link>
    </header>
  )
}

export function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 text-slate-900">
      <div className="mb-8 text-center">
        <Brand size="lg" />
      </div>
      {children}
    </main>
  )
}

export function AuthErrorCard({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <Link
        href="/login"
        className="mt-6 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
      >
        Go to sign in
      </Link>
    </div>
  )
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
    />
  )
}

export function WorkerStatusBadge({ status }: { status: WorkerStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
        statusBadgeClasses[status] ?? statusBadgeClasses.inactive
      }`}
    >
      {workerStatusLabels[status] ?? status}
    </span>
  )
}

export type Feedback = {
  tone: 'success' | 'warning' | 'error'
  message: string
}

/** Feedback message state that clears itself after five seconds. */
export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 5000)
    return () => clearTimeout(timer)
  }, [feedback])

  return [feedback, setFeedback] as const
}

export function FeedbackBanner({
  feedback,
  onDismiss,
}: {
  feedback: Feedback
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
        feedback.tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : feedback.tone === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      <span>{feedback.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}

export function Modal({
  title,
  titleId,
  onClose,
  dismissable,
  size = 'md',
  children,
}: {
  title: string
  titleId: string
  onClose: () => void
  dismissable: boolean
  size?: 'md' | 'xl'
  children: ReactNode
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && dismissable) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, dismissable])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget && dismissable) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-full w-full ${size === 'xl' ? 'max-w-3xl' : 'max-w-lg'} overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <button
            onClick={onClose}
            disabled={!dismissable}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Add/Edit worker form. company_id is never a form field: it is passed in
 * from the signed-in user's profile.
 */
export function WorkerFormModal({
  companyId,
  worker,
  initialValues,
  onSaved,
  onClose,
}: {
  companyId: string
  worker: Worker | null
  initialValues: WorkerFormValues
  onSaved: (worker: Worker) => void
  onClose: () => void
}) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<WorkerFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEdit = worker !== null

  function updateField<K extends keyof WorkerFormValues>(
    field: K,
    value: WorkerFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)

    const validationErrors = validateWorkerForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setSaving(true)
    try {
      const result = isEdit
        ? await updateWorker(companyId, worker.id, values)
        : await createWorker(companyId, values)

      if (result.error !== null) {
        setSubmitError(result.error)
        return
      }
      onSaved(result.data)
    } catch {
      setSubmitError('Something went wrong. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Worker' : 'Add Worker'}
      titleId="worker-form-title"
      onClose={onClose}
      dismissable={!saving}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4 p-6">
          {submitError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {submitError}
            </div>
          )}

          <FormField id="fullName" label="Full Name" required error={errors.fullName}>
            <input
              id="fullName"
              autoComplete="off"
              value={values.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              disabled={saving}
              placeholder="e.g. Thabo Mokoena"
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={errors.fullName ? 'fullName-error' : undefined}
              className={inputClasses(Boolean(errors.fullName))}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="idNumber"
              label="ID Number"
              hint="SA ID or passport number."
              error={errors.idNumber}
            >
              <input
                id="idNumber"
                autoComplete="off"
                value={values.idNumber}
                onChange={(e) => updateField('idNumber', e.target.value)}
                disabled={saving}
                aria-invalid={errors.idNumber ? true : undefined}
                aria-describedby={errors.idNumber ? 'idNumber-error' : 'idNumber-hint'}
                className={inputClasses(Boolean(errors.idNumber))}
              />
            </FormField>

            <FormField id="phone" label="Phone" error={errors.phone}>
              <input
                id="phone"
                type="tel"
                autoComplete="off"
                value={values.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                disabled={saving}
                placeholder="e.g. 082 123 4567"
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                className={inputClasses(Boolean(errors.phone))}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="trade" label="Trade" error={errors.trade}>
              <input
                id="trade"
                list="trade-suggestions"
                autoComplete="off"
                value={values.trade}
                onChange={(e) => updateField('trade', e.target.value)}
                disabled={saving}
                placeholder="e.g. Electrician"
                aria-invalid={errors.trade ? true : undefined}
                aria-describedby={errors.trade ? 'trade-error' : undefined}
                className={inputClasses(Boolean(errors.trade))}
              />
              <datalist id="trade-suggestions">
                {TRADE_SUGGESTIONS.map((trade) => (
                  <option key={trade} value={trade} />
                ))}
              </datalist>
            </FormField>

            <FormField id="status" label="Status" error={errors.status}>
              <select
                id="status"
                value={values.status}
                onChange={(e) => updateField('status', e.target.value as WorkerStatus)}
                disabled={saving}
                className={inputClasses(Boolean(errors.status))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </FormField>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Worker'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function DeleteWorkerModal({
  worker,
  onConfirm,
  onClose,
}: {
  worker: Worker
  onConfirm: () => Promise<string | null>
  onClose: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setError(null)
    setDeleting(true)
    try {
      const result = await onConfirm()
      if (result) setError(result)
    } catch {
      setError('Something went wrong. Please check your connection and try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      title="Delete worker?"
      titleId="delete-worker-title"
      onClose={onClose}
      dismissable={!deleting}
    >
      <div className="space-y-4 p-6 text-sm">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700"
          >
            {error}
          </div>
        )}
        <p className="text-slate-600">
          Are you sure you want to permanently delete{' '}
          <span className="font-medium text-slate-900">{worker.full_name}</span>
          ?
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          This removes the worker&apos;s record, their project assignments and
          all of their documents and uploaded files from your company. It
          cannot be undone. If they have
          only left temporarily, consider setting their status to Inactive
          instead.
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={deleting}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={deleting}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? 'Deleting…' : 'Delete Worker'}
        </button>
      </div>
    </Modal>
  )
}

export function FormField({
  id,
  label,
  required = false,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
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

export function inputClasses(hasError: boolean) {
  return `block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 ${
    hasError
      ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
      : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
  }`
}
