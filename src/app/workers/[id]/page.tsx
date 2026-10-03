'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useRequireProfile } from '@/lib/useRequireProfile'
import {
  deleteWorker,
  isUuid,
  WORKER_COLUMNS,
  workerToFormValues,
  type Worker,
} from '@/lib/workers'
import {
  AppHeader,
  AuthErrorCard,
  CenteredScreen,
  DeleteWorkerModal,
  FeedbackBanner,
  Spinner,
  useFeedback,
  WorkerFormModal,
  WorkerStatusBadge,
} from '../WorkerComponents'
import { WorkerDocumentsSection } from '../WorkerDocumentsSection'

type WorkerState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; worker: Worker }

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export default function WorkerProfilePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const workerId = params.id
  const auth = useRequireProfile()
  const companyId = auth.status === 'ready' ? auth.profile.company_id : null

  const [state, setState] = useState<WorkerState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function loadWorker() {
      // A malformed ID can't match any worker; skip the query.
      if (!isUuid(workerId)) {
        setState({ status: 'not-found' })
        return
      }

      // Scoped to the user's company; RLS also hides other companies' rows,
      // so another company's worker looks exactly like a missing one.
      const { data, error } = await supabase
        .from('workers')
        .select(WORKER_COLUMNS)
        .eq('id', workerId)
        .eq('company_id', companyId)
        .maybeSingle<Worker>()
      if (cancelled) return

      if (error) {
        setState({ status: 'error' })
        return
      }

      setState(data ? { status: 'ready', worker: data } : { status: 'not-found' })
    }

    loadWorker()

    return () => {
      cancelled = true
    }
  }, [companyId, workerId, reloadKey])

  async function handleDelete(worker: Worker): Promise<string | null> {
    if (!companyId) return 'Your session is not ready yet.'

    const error = await deleteWorker(companyId, worker.id)
    if (error) return error

    router.replace('/workers')
    return null
  }

  if (auth.status === 'loading') {
    return (
      <CenteredScreen>
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">Loading worker…</p>
      </CenteredScreen>
    )
  }

  if (auth.status === 'error') {
    return (
      <CenteredScreen>
        <AuthErrorCard title={auth.title} message={auth.message} />
      </CenteredScreen>
    )
  }

  const worker = state.status === 'ready' ? state.worker : null

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />

      <div className="mx-auto max-w-4xl space-y-6 p-6 lg:p-8">
        <nav className="text-sm text-slate-500">
          <Link href="/" className="hover:text-slate-900">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          <Link href="/workers" className="hover:text-slate-900">
            Workers
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{worker?.full_name ?? 'Worker'}</span>
        </nav>

        {state.status === 'loading' ? (
          <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-10 shadow-sm">
            <Spinner />
            <p className="mt-4 text-sm text-slate-500">Loading worker…</p>
          </div>
        ) : state.status === 'error' ? (
          <MessageCard
            title="We couldn't load this worker"
            message="Please check your connection and try again."
            action={
              <button
                onClick={() => {
                  setState({ status: 'loading' })
                  setReloadKey((key) => key + 1)
                }}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Try again
              </button>
            }
          />
        ) : state.status === 'not-found' ? (
          <MessageCard
            title="Worker not found"
            message="This worker doesn't exist or isn't part of your company."
            action={
              <Link
                href="/workers"
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                ← Back to Workers
              </Link>
            }
          />
        ) : (
          worker && (
            <>
              {feedback && (
                <FeedbackBanner
                  feedback={feedback}
                  onDismiss={() => setFeedback(null)}
                />
              )}

              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white">
                      {getInitials(worker.full_name)}
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold">{worker.full_name}</h1>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span>{worker.trade || 'No trade set'}</span>
                        <WorkerStatusBadge status={worker.status} />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditing(true)}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleting(true)}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <dl className="grid gap-6 p-6 sm:grid-cols-2">
                  <Detail label="Full Name" value={worker.full_name} />
                  <Detail label="Trade" value={worker.trade} />
                  <Detail label="Phone" value={worker.phone} />
                  <Detail label="ID Number" value={worker.id_number} />
                  <div>
                    <dt className="text-sm text-slate-500">Status</dt>
                    <dd className="mt-1">
                      <WorkerStatusBadge status={worker.status} />
                    </dd>
                  </div>
                  <Detail
                    label="Added"
                    value={dateFormatter.format(new Date(worker.created_at))}
                  />
                </dl>
              </section>

              {companyId && (
                <WorkerDocumentsSection companyId={companyId} workerId={worker.id} />
              )}
            </>
          )
        )}
      </div>

      {editing && worker && companyId && (
        <WorkerFormModal
          companyId={companyId}
          worker={worker}
          initialValues={workerToFormValues(worker)}
          onSaved={(saved) => {
            setState({ status: 'ready', worker: saved })
            setEditing(false)
            setFeedback({ tone: 'success', message: 'Worker details updated.' })
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {deleting && worker && (
        <DeleteWorkerModal
          worker={worker}
          onConfirm={() => handleDelete(worker)}
          onClose={() => setDeleting(false)}
        />
      )}
    </main>
  )
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium">
        {value || <span className="font-normal text-slate-400">Not provided</span>}
      </dd>
    </div>
  )
}

function MessageCard({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <div className="mt-6">{action}</div>
    </div>
  )
}
