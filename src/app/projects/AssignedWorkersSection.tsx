'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  assignWorkers,
  loadAssignedWorkers,
  removeAssignment,
  type AssignedWorker,
} from '@/lib/projects'
import {
  sortWorkers,
  WORKER_COLUMNS,
  workerMatchesSearch,
  type Worker,
} from '@/lib/workers'
import {
  FeedbackBanner,
  Modal,
  Spinner,
  useFeedback,
  WorkerStatusBadge,
} from '@/app/workers/WorkerComponents'

/**
 * Workers assigned to one project. companyId comes from the signed-in user's
 * profile; projectId from the route, after the project has been loaded
 * through the company-scoped query.
 */
export function AssignedWorkersSection({
  companyId,
  projectId,
  onAssignmentsChange,
}: {
  companyId: string
  projectId: string
  /** Called after workers are assigned or removed. */
  onAssignmentsChange?: () => void
}) {
  const [assigned, setAssigned] = useState<AssignedWorker[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [assigning, setAssigning] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<AssignedWorker | null>(null)
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    let cancelled = false

    async function load() {
      const result = await loadAssignedWorkers(projectId)
      if (cancelled) return
      setLoadError(result === null)
      setAssigned(result)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  function reload() {
    setLoadError(false)
    setAssigned(null)
    setReloadKey((key) => key + 1)
  }

  async function handleRemove(assignment: AssignedWorker): Promise<string | null> {
    const error = await removeAssignment(projectId, assignment.assignmentId)
    if (error) return error

    setAssigned((prev) =>
      (prev ?? []).filter((a) => a.assignmentId !== assignment.assignmentId)
    )
    setRemoveTarget(null)
    onAssignmentsChange?.()
    setFeedback({
      tone: 'success',
      message: `${assignment.worker.full_name} was removed from this project.`,
    })
    return null
  }

  const count = assigned?.length ?? 0

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Assigned Workers</h2>
          <p className="mt-1 text-sm text-slate-500">
            {assigned === null
              ? 'Loading workers…'
              : `${count} ${count === 1 ? 'worker' : 'workers'} assigned`}
          </p>
        </div>

        <button
          onClick={() => setAssigning(true)}
          disabled={assigned === null}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Assign Workers
        </button>
      </div>

      {feedback && (
        <div className="border-b border-slate-200 p-4">
          <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      )}

      {loadError ? (
        <div className="p-10 text-center">
          <p className="font-medium">We couldn&apos;t load the assigned workers.</p>
          <button
            onClick={reload}
            className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Try again
          </button>
        </div>
      ) : assigned === null ? (
        <div className="flex flex-col items-center p-10">
          <Spinner />
          <p className="mt-4 text-sm text-slate-500">Loading workers…</p>
        </div>
      ) : assigned.length === 0 ? (
        <div className="p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-xl text-blue-600">
            ◉
          </div>
          <p className="mt-4 font-medium">No workers assigned yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Assign the workers who will be on this site.
          </p>
          <button
            onClick={() => setAssigning(true)}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            Assign Workers
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
                  <th className="px-6 py-3 font-medium">Worker Status</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assigned.map((assignment) => (
                  <tr key={assignment.assignmentId} className="hover:bg-slate-50/60">
                    <td className="px-6 py-4 font-medium">
                      <Link
                        href={`/workers/${assignment.worker.id}`}
                        className="hover:text-blue-600"
                      >
                        {assignment.worker.full_name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {assignment.worker.trade || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                      {assignment.worker.phone || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <WorkerStatusBadge status={assignment.worker.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <AssignmentActions
                        workerId={assignment.worker.id}
                        onRemove={() => setRemoveTarget(assignment)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {assigned.map((assignment) => (
              <li key={assignment.assignmentId} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/workers/${assignment.worker.id}`}
                      className="font-medium hover:text-blue-600"
                    >
                      {assignment.worker.full_name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {[assignment.worker.trade, assignment.worker.phone]
                        .filter(Boolean)
                        .join(' · ') || 'No trade or phone set'}
                    </div>
                  </div>
                  <WorkerStatusBadge status={assignment.worker.status} />
                </div>
                <div className="mt-3">
                  <AssignmentActions
                    workerId={assignment.worker.id}
                    onRemove={() => setRemoveTarget(assignment)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {assigning && assigned && (
        <AssignWorkersModal
          companyId={companyId}
          projectId={projectId}
          assignedWorkerIds={new Set(assigned.map((a) => a.worker.id))}
          onAssigned={(count) => {
            setAssigning(false)
            reload()
            onAssignmentsChange?.()
            setFeedback({
              tone: 'success',
              message: `${count} ${count === 1 ? 'worker was' : 'workers were'} assigned to this project.`,
            })
          }}
          onDuplicate={reload}
          onClose={() => setAssigning(false)}
        />
      )}

      {removeTarget && (
        <RemoveAssignmentModal
          assignment={removeTarget}
          onConfirm={() => handleRemove(removeTarget)}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </section>
  )
}

function AssignmentActions({
  workerId,
  onRemove,
}: {
  workerId: string
  onRemove: () => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-2">
      <Link
        href={`/workers/${workerId}`}
        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
      >
        View
      </Link>
      <button
        onClick={onRemove}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Remove
      </button>
    </div>
  )
}

function AssignWorkersModal({
  companyId,
  projectId,
  assignedWorkerIds,
  onAssigned,
  onDuplicate,
  onClose,
}: {
  companyId: string
  projectId: string
  assignedWorkerIds: Set<string>
  onAssigned: (count: number) => void
  onDuplicate: () => void
  onClose: () => void
}) {
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Only this company's workers can be offered for assignment.
      const { data, error: queryError } = await supabase
        .from('workers')
        .select(WORKER_COLUMNS)
        .eq('company_id', companyId)
        .overrideTypes<Worker[], { merge: false }>()
      if (cancelled) return

      if (queryError) {
        setLoadError(true)
        return
      }
      setWorkers(sortWorkers(data ?? []))
    }

    load()

    return () => {
      cancelled = true
    }
  }, [companyId])

  function toggle(workerId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(workerId)) next.delete(workerId)
      else next.add(workerId)
      return next
    })
  }

  async function handleAssign() {
    setError(null)
    // Never re-insert workers that are already assigned.
    const workerIds = [...selected].filter((id) => !assignedWorkerIds.has(id))
    if (workerIds.length === 0) {
      setError('Select at least one worker to assign.')
      return
    }

    setSaving(true)
    try {
      const result = await assignWorkers(companyId, projectId, workerIds)
      if (result.error) {
        setError(result.error)
        if (result.duplicate) onDuplicate()
        return
      }
      onAssigned(workerIds.length)
    } catch {
      setError('Something went wrong. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const visibleWorkers = workers?.filter((w) => workerMatchesSearch(w, search)) ?? []
  const availableCount =
    workers?.filter((w) => !assignedWorkerIds.has(w.id)).length ?? 0
  const selectedCount = selected.size

  return (
    <Modal
      title="Assign Workers"
      titleId="assign-workers-title"
      onClose={onClose}
      dismissable={!saving}
    >
      <div className="space-y-4 p-6">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {loadError ? (
          <p className="py-6 text-center text-sm text-slate-600">
            We couldn&apos;t load your workers. Please close this window and try
            again.
          </p>
        ) : workers === null ? (
          <div className="flex flex-col items-center py-6">
            <Spinner />
            <p className="mt-4 text-sm text-slate-500">Loading workers…</p>
          </div>
        ) : workers.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-600">
            <p>Your company doesn&apos;t have any workers yet.</p>
            <Link
              href="/workers"
              className="mt-3 inline-block font-medium text-blue-600 hover:text-blue-700"
            >
              Go to Workers
            </Link>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="assign-search" className="sr-only">
                Search workers
              </label>
              <input
                id="assign-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, trade, phone or ID number"
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-2 text-xs text-slate-500">
                {availableCount === 0
                  ? 'All of your workers are already assigned to this project.'
                  : `${availableCount} available · ${selectedCount} selected`}
              </p>
            </div>

            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {visibleWorkers.length === 0 ? (
                <li className="p-4 text-center text-sm text-slate-500">
                  No workers match “{search.trim()}”.
                </li>
              ) : (
                visibleWorkers.map((worker) => {
                  const alreadyAssigned = assignedWorkerIds.has(worker.id)
                  const inputId = `assign-${worker.id}`
                  return (
                    <li key={worker.id}>
                      <label
                        htmlFor={inputId}
                        className={`flex items-center gap-3 px-4 py-3 text-sm ${
                          alreadyAssigned
                            ? 'cursor-not-allowed bg-slate-50'
                            : 'cursor-pointer hover:bg-slate-50'
                        }`}
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={alreadyAssigned || selected.has(worker.id)}
                          disabled={alreadyAssigned || saving}
                          onChange={() => toggle(worker.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block font-medium ${alreadyAssigned ? 'text-slate-500' : ''}`}
                          >
                            {worker.full_name}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {worker.trade || 'No trade set'}
                          </span>
                        </span>
                        {alreadyAssigned ? (
                          <span className="whitespace-nowrap rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                            Assigned
                          </span>
                        ) : (
                          worker.status === 'inactive' && (
                            <WorkerStatusBadge status={worker.status} />
                          )
                        )}
                      </label>
                    </li>
                  )
                })
              )}
            </ul>
          </>
        )}
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
          type="button"
          onClick={handleAssign}
          disabled={saving || selectedCount === 0}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          )}
          {saving
            ? 'Assigning…'
            : selectedCount > 0
              ? `Assign ${selectedCount} ${selectedCount === 1 ? 'Worker' : 'Workers'}`
              : 'Assign Workers'}
        </button>
      </div>
    </Modal>
  )
}

function RemoveAssignmentModal({
  assignment,
  onConfirm,
  onClose,
}: {
  assignment: AssignedWorker
  onConfirm: () => Promise<string | null>
  onClose: () => void
}) {
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setError(null)
    setRemoving(true)
    try {
      const result = await onConfirm()
      if (result) setError(result)
    } catch {
      setError('Something went wrong. Please check your connection and try again.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Modal
      title="Remove from project?"
      titleId="remove-assignment-title"
      onClose={onClose}
      dismissable={!removing}
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
          Remove{' '}
          <span className="font-medium text-slate-900">
            {assignment.worker.full_name}
          </span>{' '}
          from this project?
        </p>
        <p className="text-slate-500">
          Only the project assignment is removed. The worker, their documents
          and files stay in your company, and you can assign them again later.
        </p>
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={removing}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={removing}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {removing ? 'Removing…' : 'Remove from Project'}
        </button>
      </div>
    </Modal>
  )
}
