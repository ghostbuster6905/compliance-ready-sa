'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRequireProfile } from '@/lib/useRequireProfile'
import {
  deleteWorker,
  emptyWorkerFormValues,
  sortWorkers,
  WORKER_COLUMNS,
  workerMatchesSearch,
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
} from './WorkerComponents'

type FormState = { mode: 'add' } | { mode: 'edit'; worker: Worker } | null

export default function WorkersPage() {
  const auth = useRequireProfile()
  const companyId = auth.status === 'ready' ? auth.profile.company_id : null

  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [formState, setFormState] = useState<FormState>(null)
  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null)
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function loadWorkers() {
      const { data, error } = await supabase
        .from('workers')
        .select(WORKER_COLUMNS)
        .eq('company_id', companyId)
        .overrideTypes<Worker[], { merge: false }>()
      if (cancelled) return

      if (error) {
        setLoadError("We couldn't load your workers. Please try again.")
        return
      }

      setLoadError(null)
      setWorkers(sortWorkers(data ?? []))
    }

    loadWorkers()

    return () => {
      cancelled = true
    }
  }, [companyId, reloadKey])

  function retryLoad() {
    setLoadError(null)
    setWorkers(null)
    setReloadKey((key) => key + 1)
  }

  function handleSaved(saved: Worker) {
    const isAdd = formState?.mode === 'add'
    setWorkers((prev) =>
      sortWorkers(
        isAdd
          ? [...(prev ?? []), saved]
          : (prev ?? []).map((w) => (w.id === saved.id ? saved : w))
      )
    )
    setFormState(null)
    setFeedback({
      tone: 'success',
      message: `${saved.full_name} was ${isAdd ? 'added' : 'updated'}.`,
    })
  }

  async function handleDelete(worker: Worker): Promise<string | null> {
    if (!companyId) return 'Your session is not ready yet.'

    const error = await deleteWorker(companyId, worker.id)
    if (error) return error

    setWorkers((prev) => (prev ?? []).filter((w) => w.id !== worker.id))
    setDeleteTarget(null)
    setFeedback({ tone: 'success', message: `${worker.full_name} was deleted.` })
    return null
  }

  if (auth.status === 'loading') {
    return (
      <CenteredScreen>
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">Loading workers…</p>
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

  const filteredWorkers = workers?.filter((w) => workerMatchesSearch(w, search)) ?? []
  const workerCount = workers?.length ?? 0
  const activeCount = workers?.filter((w) => w.status === 'active').length ?? 0
  const isSearching = search.trim().length > 0

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />

      <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <nav className="mb-2 text-sm text-slate-500">
              <Link href="/" className="hover:text-slate-900">
                Dashboard
              </Link>
              <span className="mx-2">/</span>
              <span className="text-slate-900">Workers</span>
            </nav>
            <h1 className="text-2xl font-bold">Workers</h1>
            <p className="mt-1 text-slate-500">
              {workers === null
                ? 'Loading workers…'
                : `${workerCount} ${workerCount === 1 ? 'worker' : 'workers'} · ${activeCount} active`}
            </p>
          </div>

          <button
            onClick={() => setFormState({ mode: 'add' })}
            disabled={workers === null}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Add Worker
          </button>
        </div>

        {feedback && (
          <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
        )}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loadError ? (
            <div className="p-10 text-center">
              <p className="font-medium">{loadError}</p>
              <button
                onClick={retryLoad}
                className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Try again
              </button>
            </div>
          ) : workers === null ? (
            <div className="flex flex-col items-center p-10">
              <Spinner />
              <p className="mt-4 text-sm text-slate-500">Loading workers…</p>
            </div>
          ) : workers.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-xl text-blue-600">
                ◉
              </div>
              <h2 className="mt-4 font-semibold">No workers yet.</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                Add the people who work on your sites so you can track their
                compliance documents.
              </p>
              <button
                onClick={() => setFormState({ mode: 'add' })}
                className="mt-6 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
              >
                Add Worker
              </button>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 p-4 sm:px-6">
                <label htmlFor="worker-search" className="sr-only">
                  Search workers
                </label>
                <div className="relative max-w-md">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400"
                  >
                    ⌕
                  </span>
                  <input
                    id="worker-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, trade, phone or ID number"
                    className="block w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {isSearching && (
                  <p className="mt-2 text-xs text-slate-500">
                    Showing {filteredWorkers.length} of {workerCount}
                  </p>
                )}
              </div>

              {filteredWorkers.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="font-medium">No workers match “{search.trim()}”.</p>
                  <button
                    onClick={() => setSearch('')}
                    className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-6 py-3 font-medium">Full Name</th>
                          <th className="px-6 py-3 font-medium">Trade</th>
                          <th className="px-6 py-3 font-medium">Phone</th>
                          <th className="px-6 py-3 font-medium">ID Number</th>
                          <th className="px-6 py-3 font-medium">Status</th>
                          <th className="px-6 py-3 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredWorkers.map((worker) => (
                          <tr key={worker.id} className="hover:bg-slate-50/60">
                            <td className="px-6 py-4 font-medium">
                              <Link
                                href={`/workers/${worker.id}`}
                                className="hover:text-blue-600"
                              >
                                {worker.full_name}
                              </Link>
                            </td>
                            <td className="px-6 py-4 text-slate-600">
                              <Value text={worker.trade} />
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                              <Value text={worker.phone} />
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                              <Value text={worker.id_number} />
                            </td>
                            <td className="px-6 py-4">
                              <WorkerStatusBadge status={worker.status} />
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right">
                              <RowActions
                                worker={worker}
                                onEdit={() => setFormState({ mode: 'edit', worker })}
                                onDelete={() => setDeleteTarget(worker)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile list */}
                  <ul className="divide-y divide-slate-100 md:hidden">
                    {filteredWorkers.map((worker) => (
                      <li key={worker.id} className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <Link
                              href={`/workers/${worker.id}`}
                              className="font-medium hover:text-blue-600"
                            >
                              {worker.full_name}
                            </Link>
                            <div className="text-xs text-slate-500">
                              {worker.trade || 'No trade set'}
                            </div>
                          </div>
                          <WorkerStatusBadge status={worker.status} />
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <dt className="text-slate-500">Phone</dt>
                            <dd className="font-medium">
                              <Value text={worker.phone} />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">ID Number</dt>
                            <dd className="font-medium">
                              <Value text={worker.id_number} />
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-3">
                          <RowActions
                            worker={worker}
                            onEdit={() => setFormState({ mode: 'edit', worker })}
                            onDelete={() => setDeleteTarget(worker)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {formState && companyId && (
        <WorkerFormModal
          key={formState.mode === 'edit' ? formState.worker.id : 'add'}
          companyId={companyId}
          worker={formState.mode === 'edit' ? formState.worker : null}
          initialValues={
            formState.mode === 'edit'
              ? workerToFormValues(formState.worker)
              : emptyWorkerFormValues
          }
          onSaved={handleSaved}
          onClose={() => setFormState(null)}
        />
      )}

      {deleteTarget && (
        <DeleteWorkerModal
          worker={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </main>
  )
}

function Value({ text }: { text: string | null }) {
  return text ? <>{text}</> : <span className="text-slate-400">—</span>
}

function RowActions({
  worker,
  onEdit,
  onDelete,
}: {
  worker: Worker
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-2">
      <Link
        href={`/workers/${worker.id}`}
        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
      >
        View
      </Link>
      <button
        onClick={onEdit}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    </div>
  )
}
