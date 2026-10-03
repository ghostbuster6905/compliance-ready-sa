'use client'

import { useEffect, useState, type ReactNode, type SubmitEvent } from 'react'
import Link from 'next/link'
import {
  calculateChecklistProgress,
  calculateDocumentHealth,
  calculateReadiness,
  buildAttentionItems,
  type AttentionItem,
  type DocumentHealth,
  type HealthDocument,
  type ReadinessLabel,
} from '@/lib/readiness'
import {
  checklistItemToFormValues,
  createChecklistItem,
  deleteChecklistItem,
  emptyChecklistFormValues,
  loadAssignedWorkerDocuments,
  loadChecklist,
  loadCompanyDocumentHealth,
  setChecklistItemCompleted,
  updateChecklistItem,
  validateChecklistForm,
  type AssignedWorkerDocument,
  type ChecklistFormErrors,
  type ChecklistFormValues,
  type ChecklistItem,
} from '@/lib/projectCompliance'
import {
  FeedbackBanner,
  FormField,
  inputClasses,
  Modal,
  Spinner,
  useFeedback,
} from '@/app/workers/WorkerComponents'
import { formatProjectDate } from './ProjectComponents'

const DISCLAIMER =
  'Readiness is based on the requirements and document records configured in ComplianceReady SA. Project, client and legal requirements may differ.'

const labelClasses: Record<ReadinessLabel, string> = {
  'Strong readiness': 'bg-emerald-50 text-emerald-700',
  'Needs attention': 'bg-amber-100 text-amber-800',
  'Action required': 'bg-red-100 text-red-700',
}

const scoreRingClasses: Record<ReadinessLabel, string> = {
  'Strong readiness': 'text-emerald-600',
  'Needs attention': 'text-amber-600',
  'Action required': 'text-red-600',
}

const ATTENTION_PREVIEW_COUNT = 8

type ChecklistFormState = { mode: 'add' } | { mode: 'edit'; item: ChecklistItem } | null

/**
 * Project readiness, checklist, attention items and document health. Only
 * rendered after the project has been loaded through the company-scoped
 * project query, so projectId is known to belong to companyId.
 */
export function ProjectComplianceSection({
  companyId,
  projectId,
  assignmentVersion,
}: {
  companyId: string
  projectId: string
  /** Changes whenever workers are assigned or removed, to refresh worker documents. */
  assignmentVersion: number
}) {
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null)
  const [workerDocuments, setWorkerDocuments] = useState<AssignedWorkerDocument[] | null>(null)
  const [companyDocuments, setCompanyDocuments] = useState<HealthDocument[] | null>(null)
  const [loadErrors, setLoadErrors] = useState({ checklist: false, worker: false, company: false })
  const [reloadKey, setReloadKey] = useState(0)

  const [formState, setFormState] = useState<ChecklistFormState>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChecklistItem | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [showAllAttention, setShowAllAttention] = useState(false)
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    let cancelled = false
    loadChecklist(projectId).then((result) => {
      if (cancelled) return
      setLoadErrors((prev) => ({ ...prev, checklist: result === null }))
      setChecklist(result)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  useEffect(() => {
    let cancelled = false
    loadAssignedWorkerDocuments(companyId, projectId).then((result) => {
      if (cancelled) return
      setLoadErrors((prev) => ({ ...prev, worker: result === null }))
      setWorkerDocuments(result)
    })
    return () => {
      cancelled = true
    }
  }, [companyId, projectId, assignmentVersion, reloadKey])

  useEffect(() => {
    let cancelled = false
    loadCompanyDocumentHealth(companyId).then((result) => {
      if (cancelled) return
      setLoadErrors((prev) => ({ ...prev, company: result === null }))
      setCompanyDocuments(result)
    })
    return () => {
      cancelled = true
    }
  }, [companyId, reloadKey])

  function reloadAll() {
    setLoadErrors({ checklist: false, worker: false, company: false })
    setChecklist(null)
    setWorkerDocuments(null)
    setCompanyDocuments(null)
    setReloadKey((key) => key + 1)
  }

  async function toggleCompleted(item: ChecklistItem) {
    setTogglingId(item.id)
    const result = await setChecklistItemCompleted(projectId, item.id, !item.completed)
    setTogglingId(null)

    if (result.error !== null) {
      setFeedback({ tone: 'error', message: result.error })
      return
    }
    const saved = result.data
    setChecklist((prev) => (prev ?? []).map((i) => (i.id === saved.id ? saved : i)))
  }

  function handleSaved(saved: ChecklistItem, isAdd: boolean) {
    setChecklist((prev) =>
      isAdd ? [...(prev ?? []), saved] : (prev ?? []).map((i) => (i.id === saved.id ? saved : i))
    )
    setFormState(null)
    setFeedback({
      tone: 'success',
      message: `${saved.item_name} was ${isAdd ? 'added' : 'updated'}.`,
    })
  }

  async function handleDelete(item: ChecklistItem): Promise<string | null> {
    const error = await deleteChecklistItem(projectId, item.id)
    if (error) return error

    setChecklist((prev) => (prev ?? []).filter((i) => i.id !== item.id))
    setDeleteTarget(null)
    setFeedback({ tone: 'success', message: `${item.item_name} was deleted.` })
    return null
  }

  const hasLoadError = loadErrors.checklist || loadErrors.worker || loadErrors.company
  const isLoading = !hasLoadError && (!checklist || !workerDocuments || !companyDocuments)

  const progress = checklist ? calculateChecklistProgress(checklist) : null
  const workerHealth = workerDocuments ? calculateDocumentHealth(workerDocuments) : null
  const companyHealth = companyDocuments ? calculateDocumentHealth(companyDocuments) : null
  const readiness =
    progress && workerHealth && companyHealth
      ? calculateReadiness(progress, workerHealth, companyHealth)
      : null
  const attentionItems =
    checklist && workerDocuments && companyDocuments
      ? buildAttentionItems({
          workerDocuments,
          companyDocuments,
          checklistItems: checklist,
          formatDate: formatProjectDate,
        })
      : null
  const assignedWorkerCount = workerDocuments
    ? new Set(workerDocuments.map((d) => d.workerId)).size
    : 0

  const componentDetails: Record<string, string> = {
    checklist: progress
      ? progress.totalRequired > 0
        ? `${progress.completedRequired} of ${progress.totalRequired} required items complete`
        : 'No required checklist items configured'
      : '',
    workerDocuments: workerHealth
      ? workerHealth.total > 0
        ? `${workerHealth.total} ${workerHealth.total === 1 ? 'document' : 'documents'} across ${assignedWorkerCount} assigned ${assignedWorkerCount === 1 ? 'worker' : 'workers'}`
        : 'No documents recorded for assigned workers'
      : '',
    companyDocuments: companyHealth
      ? companyHealth.total > 0
        ? `${companyHealth.total} company ${companyHealth.total === 1 ? 'document' : 'documents'}`
        : 'No company documents recorded'
      : '',
  }

  return (
    <>
      {/* Project Readiness */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-6">
          <h2 className="font-semibold">Project Readiness</h2>
          <p className="mt-1 text-sm text-slate-500">
            How prepared this project is, based on its checklist and the
            documents recorded for it.
          </p>
        </div>

        {hasLoadError ? (
          <div className="p-10 text-center">
            <p className="font-medium">We couldn&apos;t calculate project readiness.</p>
            <p className="mt-1 text-sm text-slate-500">
              Some project information failed to load.
            </p>
            <button
              onClick={reloadAll}
              className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Try again
            </button>
          </div>
        ) : isLoading || !readiness ? (
          <div className="flex flex-col items-center p-10">
            <Spinner />
            <p className="mt-4 text-sm text-slate-500">Calculating readiness…</p>
          </div>
        ) : (
          <div className="space-y-6 p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <ScoreRing score={readiness.overall} label={readiness.label} />
              <div>
                {readiness.overall !== null && readiness.label ? (
                  <>
                    <div className="text-sm text-slate-500">Project Readiness</div>
                    <div className="text-3xl font-bold">{readiness.overall}%</div>
                    <span
                      className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${labelClasses[readiness.label]}`}
                    >
                      {readiness.label}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-semibold">Not enough information yet</div>
                    <p className="mt-1 max-w-md text-sm text-slate-500">
                      Add required checklist items or record worker and company
                      documents to calculate project readiness.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {readiness.components.map((component) => (
                <div
                  key={component.key}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="text-sm text-slate-500">{component.label}</div>
                  <div
                    className={`mt-1 font-semibold ${
                      component.score === null ? 'text-slate-400' : 'text-2xl'
                    }`}
                  >
                    {component.score === null
                      ? component.emptyLabel
                      : `${Math.round(component.score)}%`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {componentDetails[component.key]}
                  </div>
                </div>
              ))}
            </div>

            <details className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-700">
                How is this calculated?
              </summary>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                <li>
                  <strong>Checklist:</strong> completed required items ÷ total
                  required items. Optional items don&apos;t affect the score.
                </li>
                <li>
                  <strong>Worker and Company Documents:</strong> each recorded
                  document counts as Valid = 100%, Expiring (within 30 days) =
                  50%, Expired = 0%, then averaged.
                </li>
                <li>
                  <strong>Project Readiness</strong> is the average of the
                  components above that have data, rounded to a whole
                  percentage. Components marked &quot;Not configured&quot; or
                  &quot;No documents recorded&quot; are left out rather than
                  counted as 100%.
                </li>
                <li>
                  90–100%: Strong readiness · 70–89%: Needs attention · below
                  70%: Action required.
                </li>
              </ul>
            </details>

            <p className="text-xs text-slate-500">{DISCLAIMER}</p>
          </div>
        )}
      </section>

      {/* Checklist */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Checklist</h2>
            <p className="mt-1 text-sm text-slate-500">
              {!progress
                ? 'Loading checklist…'
                : progress.totalRequired > 0
                  ? `${progress.completedRequired} of ${progress.totalRequired} required items complete`
                  : 'No required checklist items configured'}
              {progress && progress.optionalCount > 0 &&
                ` · ${progress.completedOptional} of ${progress.optionalCount} optional complete`}
            </p>
          </div>
          <button
            onClick={() => setFormState({ mode: 'add' })}
            disabled={checklist === null}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Add Checklist Item
          </button>
        </div>

        {progress && progress.totalRequired > 0 && (
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress.score ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {feedback && (
          <div className="border-b border-slate-200 p-4">
            <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
          </div>
        )}

        {loadErrors.checklist ? (
          <div className="p-10 text-center">
            <p className="font-medium">We couldn&apos;t load the checklist.</p>
            <button
              onClick={reloadAll}
              className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Try again
            </button>
          </div>
        ) : checklist === null ? (
          <div className="flex flex-col items-center p-10">
            <Spinner />
          </div>
        ) : checklist.length === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-xl text-blue-600">
              ✓
            </div>
            <p className="mt-4 font-medium">No checklist items yet.</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              Add the items this project, client or site requires, such as
              inductions, permits or safety file submissions.
            </p>
            <button
              onClick={() => setFormState({ mode: 'add' })}
              className="mt-6 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
            >
              Add Checklist Item
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {checklist.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between sm:px-6"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={togglingId === item.id}
                    onChange={() => toggleCompleted(item)}
                    aria-label={`Mark ${item.item_name} as ${item.completed ? 'incomplete' : 'complete'}`}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0">
                    <span
                      className={`block font-medium ${item.completed ? 'text-slate-500 line-through' : ''}`}
                    >
                      {item.item_name}
                    </span>
                    {item.description && (
                      <span className="mt-0.5 block whitespace-pre-line text-sm text-slate-500">
                        {item.description}
                      </span>
                    )}
                    <span className="mt-2 flex flex-wrap gap-2">
                      <Badge className={item.required ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}>
                        {item.required ? 'Required' : 'Optional'}
                      </Badge>
                      <Badge
                        className={
                          item.completed
                            ? 'bg-emerald-50 text-emerald-700'
                            : item.required
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                        }
                      >
                        {togglingId === item.id
                          ? 'Saving…'
                          : item.completed
                            ? 'Complete'
                            : 'Incomplete'}
                      </Badge>
                    </span>
                  </span>
                </label>
                <div className="flex shrink-0 gap-2 pl-7 sm:pl-0">
                  <button
                    onClick={() => setFormState({ mode: 'edit', item })}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(item)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Attention Needed */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-6">
          <h2 className="font-semibold">Attention Needed</h2>
          <p className="mt-1 text-sm text-slate-500">
            Expired and expiring documents first, then incomplete required
            checklist items.
          </p>
        </div>

        {hasLoadError ? (
          <p className="p-6 text-sm text-slate-500">
            Attention items are unavailable until all project information loads.
          </p>
        ) : attentionItems === null ? (
          <div className="flex flex-col items-center p-10">
            <Spinner />
          </div>
        ) : attentionItems.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-medium text-emerald-700">Nothing needs attention right now.</p>
            <p className="mt-1 text-sm text-slate-500">
              No expired or expiring documents, and no incomplete required
              checklist items.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {(showAllAttention
                ? attentionItems
                : attentionItems.slice(0, ATTENTION_PREVIEW_COUNT)
              ).map((item) => (
                <AttentionRow key={item.id} item={item} />
              ))}
            </ul>
            {attentionItems.length > ATTENTION_PREVIEW_COUNT && (
              <div className="border-t border-slate-200 p-4 text-center">
                <button
                  onClick={() => setShowAllAttention((v) => !v)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {showAllAttention
                    ? 'Show fewer'
                    : `Show all ${attentionItems.length} items`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Document Health */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-6">
          <h2 className="font-semibold">Document Health</h2>
          <p className="mt-1 text-sm text-slate-500">
            Based only on documents that have been recorded. Missing document
            types are not assumed.
          </p>
        </div>
        <div className="grid gap-4 p-6 md:grid-cols-2">
          <HealthCard
            title="Worker Documents"
            subtitle="Documents of workers assigned to this project"
            health={workerHealth}
            error={loadErrors.worker}
            emptyText="No documents recorded for assigned workers."
          />
          <HealthCard
            title="Company Documents"
            subtitle="Your company's documents"
            health={companyHealth}
            error={loadErrors.company}
            emptyText="No company documents recorded."
            action={
              <Link href="/documents" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                Manage company documents →
              </Link>
            }
          />
        </div>
      </section>

      {formState && (
        <ChecklistFormModal
          key={formState.mode === 'edit' ? formState.item.id : 'add'}
          projectId={projectId}
          item={formState.mode === 'edit' ? formState.item : null}
          onSaved={handleSaved}
          onClose={() => setFormState(null)}
        />
      )}

      {deleteTarget && (
        <DeleteChecklistItemModal
          item={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}

function ScoreRing({
  score,
  label,
}: {
  score: number | null
  label: ReadinessLabel | null
}) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - (score ?? 0) / 100)

  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="10" className="stroke-slate-100" />
        {score !== null && label && (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`stroke-current ${scoreRingClasses[label]}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xl font-bold">
        {score === null ? '—' : `${score}%`}
      </div>
    </div>
  )
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

const attentionStyles: Record<AttentionItem['severity'], { dot: string; label: string; badge: string }> = {
  expired: { dot: 'bg-red-500', label: 'Expired', badge: 'bg-red-100 text-red-700' },
  missing: { dot: 'bg-red-400', label: 'Missing', badge: 'bg-red-50 text-red-700' },
  expiring: { dot: 'bg-amber-500', label: 'Expiring', badge: 'bg-amber-100 text-amber-800' },
  checklist: { dot: 'bg-blue-500', label: 'Checklist', badge: 'bg-blue-50 text-blue-700' },
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const style = attentionStyles[item.severity]
  return (
    <li className="flex items-start gap-3 px-6 py-4 text-sm">
      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      <div className="min-w-0 flex-1">
        {item.workerId ? (
          <Link href={`/workers/${item.workerId}`} className="font-medium hover:text-blue-600">
            {item.subject}
          </Link>
        ) : item.source === 'company' ? (
          <Link href="/documents" className="font-medium hover:text-blue-600">
            {item.subject}
          </Link>
        ) : (
          <span className="font-medium">{item.subject}</span>
        )}
        <span className="text-slate-600"> — {item.message}</span>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
        {style.label}
      </span>
    </li>
  )
}

function HealthCard({
  title,
  subtitle,
  health,
  error,
  emptyText,
  action,
}: {
  title: string
  subtitle: string
  health: DocumentHealth | null
  error: boolean
  emptyText: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-5">
      <div className="font-medium">{title}</div>
      <div className="text-xs text-slate-500">{subtitle}</div>

      {error ? (
        <p className="mt-4 text-sm text-red-600">Couldn&apos;t load these documents.</p>
      ) : !health ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : health.total === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <HealthCount label="Valid" value={health.valid} className="bg-emerald-50 text-emerald-700" />
          <HealthCount label="Expiring" value={health.expiring} className="bg-amber-50 text-amber-800" />
          <HealthCount label="Expired" value={health.expired} className="bg-red-50 text-red-700" />
        </dl>
      )}
      {health && health.missing > 0 && (
        <p className="mt-2 text-xs text-red-700">
          {health.missing} marked as missing
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function HealthCount({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className: string
}) {
  return (
    <div className={`rounded-lg px-2 py-3 ${className}`}>
      <dd className="text-2xl font-bold">{value}</dd>
      <dt className="text-xs font-medium">{label}</dt>
    </div>
  )
}

function ChecklistFormModal({
  projectId,
  item,
  onSaved,
  onClose,
}: {
  projectId: string
  item: ChecklistItem | null
  onSaved: (item: ChecklistItem, isAdd: boolean) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<ChecklistFormValues>(
    item ? checklistItemToFormValues(item) : emptyChecklistFormValues
  )
  const [errors, setErrors] = useState<ChecklistFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEdit = item !== null

  function updateField<K extends keyof ChecklistFormValues>(
    field: K,
    value: ChecklistFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)

    const validationErrors = validateChecklistForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setSaving(true)
    try {
      const result = isEdit
        ? await updateChecklistItem(projectId, item.id, values)
        : await createChecklistItem(projectId, values)

      if (result.error !== null) {
        setSubmitError(result.error)
        return
      }
      onSaved(result.data, !isEdit)
    } catch {
      setSubmitError('Something went wrong. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Checklist Item' : 'Add Checklist Item'}
      titleId="checklist-form-title"
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

          <FormField id="itemName" label="Item Name" required error={errors.itemName}>
            <input
              id="itemName"
              autoComplete="off"
              value={values.itemName}
              onChange={(e) => updateField('itemName', e.target.value)}
              disabled={saving}
              placeholder="e.g. Site induction completed"
              aria-invalid={errors.itemName ? true : undefined}
              aria-describedby={errors.itemName ? 'itemName-error' : undefined}
              className={inputClasses(Boolean(errors.itemName))}
            />
          </FormField>

          <FormField id="description" label="Description" error={errors.description}>
            <textarea
              id="description"
              rows={3}
              value={values.description}
              onChange={(e) => updateField('description', e.target.value)}
              disabled={saving}
              placeholder="Optional details or evidence needed"
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? 'description-error' : undefined}
              className={inputClasses(Boolean(errors.description))}
            />
          </FormField>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={values.required}
              onChange={(e) => updateField('required', e.target.checked)}
              disabled={saving}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              <span className="block font-medium">Required</span>
              <span className="text-slate-500">
                Required items count towards project readiness. Optional items
                are tracked but don&apos;t affect the score.
              </span>
            </span>
          </label>
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Item'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteChecklistItemModal({
  item,
  onConfirm,
  onClose,
}: {
  item: ChecklistItem
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
      title="Delete checklist item?"
      titleId="delete-checklist-title"
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
          Delete <span className="font-medium text-slate-900">{item.item_name}</span>{' '}
          from this project&apos;s checklist? This cannot be undone and will
          change the project&apos;s readiness score.
        </p>
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
          {deleting ? 'Deleting…' : 'Delete Item'}
        </button>
      </div>
    </Modal>
  )
}
