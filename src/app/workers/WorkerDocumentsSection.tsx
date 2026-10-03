'use client'

import { useEffect, useState, type ChangeEvent, type SubmitEvent } from 'react'
import {
  calculateDocumentStatus,
  documentStatusLabels,
  EXPIRING_WINDOW_DAYS,
  type DocumentStatus,
} from '@/lib/documentStatus'
import {
  DOCUMENT_FILE_ACCEPT,
  formatFileSize,
  validateDocumentFile,
} from '@/lib/documentFiles'
import {
  createWorkerDocumentFileUrl,
  deleteWorkerDocument,
  getWorkerDocumentDisplayStatus,
  loadWorkerDocuments,
  OTHER_DOCUMENT_TYPE,
  saveWorkerDocument,
  sortWorkerDocuments,
  WORKER_DOCUMENT_TYPES,
  type WorkerDocument,
  type WorkerDocumentSaveStage,
} from '@/lib/workerDocuments'
import {
  FeedbackBanner,
  FormField,
  inputClasses,
  Modal,
  Spinner,
  useFeedback,
} from './WorkerComponents'

type Scope = { companyId: string; workerId: string }

type FormState = { mode: 'add' } | { mode: 'edit'; document: WorkerDocument } | null

const statusBadgeClasses: Record<DocumentStatus, string> = {
  valid: 'bg-emerald-50 text-emerald-700',
  expiring: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200',
  expired: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200',
  missing: 'bg-slate-100 text-slate-600',
}

const rowHighlight: Partial<Record<DocumentStatus, string>> = {
  expiring: 'bg-amber-50/40',
  expired: 'bg-red-50/40',
}

const saveStageLabels: Record<WorkerDocumentSaveStage, string> = {
  uploading: 'Uploading file…',
  saving: 'Saving document…',
  cleaning: 'Removing previous file…',
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDate(isoDate: string | null) {
  if (!isoDate) return '—'
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}

/**
 * Worker Documents list and CRUD for one worker. companyId comes from the
 * signed-in user's profile and workerId from the profile route, after the
 * worker has been loaded through the company-scoped query.
 */
export function WorkerDocumentsSection({ companyId, workerId }: Scope) {
  const [documents, setDocuments] = useState<WorkerDocument[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [formState, setFormState] = useState<FormState>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkerDocument | null>(null)
  const [feedback, setFeedback] = useFeedback()
  const scope = { companyId, workerId }

  useEffect(() => {
    let cancelled = false

    async function load() {
      const result = await loadWorkerDocuments(workerId)
      if (cancelled) return
      setLoadError(result === null)
      setDocuments(result)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [workerId, reloadKey])

  function retryLoad() {
    setLoadError(false)
    setDocuments(null)
    setReloadKey((key) => key + 1)
  }

  function handleSaved(saved: WorkerDocument, warning: string | null, isAdd: boolean) {
    setDocuments((prev) =>
      sortWorkerDocuments(
        isAdd
          ? [...(prev ?? []), saved]
          : (prev ?? []).map((d) => (d.id === saved.id ? saved : d))
      )
    )
    setFormState(null)
    setFeedback(
      warning
        ? { tone: 'warning', message: warning }
        : {
            tone: 'success',
            message: `${saved.document_type} was ${isAdd ? 'added' : 'updated'}.`,
          }
    )
  }

  async function handleDelete(document: WorkerDocument): Promise<string | null> {
    const error = await deleteWorkerDocument(scope, document)
    if (error) return error

    setDocuments((prev) => (prev ?? []).filter((d) => d.id !== document.id))
    setDeleteTarget(null)
    setFeedback({ tone: 'success', message: `${document.document_type} was deleted.` })
    return null
  }

  async function openFile(document: WorkerDocument, action: 'view' | 'download') {
    // Open the tab before the request so pop-up blockers allow it.
    const viewer = action === 'view' ? window.open('', '_blank') : null
    if (viewer) viewer.opener = null

    const url = await createWorkerDocumentFileUrl(
      scope,
      document,
      action === 'download' ? (document.file_name ?? undefined) : undefined
    )

    if (!url) {
      viewer?.close()
      setFeedback({
        tone: 'error',
        message:
          "We couldn't open this file. It may have been removed, or your session may have expired.",
      })
      return
    }

    if (action === 'download') {
      window.location.assign(url)
    } else if (viewer) {
      viewer.location.href = url
    } else {
      window.open(url, '_blank', 'noopener')
    }
  }

  const counts = (documents ?? []).reduce(
    (acc, d) => {
      const status = getWorkerDocumentDisplayStatus(d)
      if (status === 'expiring') acc.expiring += 1
      if (status === 'expired') acc.expired += 1
      return acc
    },
    { expiring: 0, expired: 0 }
  )
  const documentCount = documents?.length ?? 0

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Worker Documents</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>
              {documents === null
                ? 'Loading documents…'
                : `${documentCount} ${documentCount === 1 ? 'document' : 'documents'}`}
            </span>
            {counts.expired > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                {counts.expired} expired
              </span>
            )}
            {counts.expiring > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {counts.expiring} expiring
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setFormState({ mode: 'add' })}
          disabled={documents === null}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Add Document
        </button>
      </div>

      {feedback && (
        <div className="border-b border-slate-200 p-4">
          <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      )}

      {loadError ? (
        <div className="p-10 text-center">
          <p className="font-medium">
            We couldn&apos;t load this worker&apos;s documents.
          </p>
          <button
            onClick={retryLoad}
            className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Try again
          </button>
        </div>
      ) : documents === null ? (
        <div className="flex flex-col items-center p-10">
          <Spinner />
          <p className="mt-4 text-sm text-slate-500">Loading documents…</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-xl text-blue-600">
            ▣
          </div>
          <p className="mt-4 font-medium">No worker documents yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Add certificates, medicals and training records to keep track of
            their expiry dates.
          </p>
          <button
            onClick={() => setFormState({ mode: 'add' })}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            Add Document
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Document Type</th>
                  <th className="px-6 py-3 font-medium">File Name</th>
                  <th className="px-6 py-3 font-medium">Issue Date</th>
                  <th className="px-6 py-3 font-medium">Expiry Date</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((document) => {
                  const status = getWorkerDocumentDisplayStatus(document)
                  return (
                    <tr key={document.id} className={rowHighlight[status] ?? ''}>
                      <td className="px-6 py-4 font-medium">{document.document_type}</td>
                      <td className="max-w-xs px-6 py-4 text-slate-600">
                        <FileName document={document} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                        {formatDate(document.issue_date)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-6 py-4 ${
                          status === 'expired'
                            ? 'font-medium text-red-700'
                            : status === 'expiring'
                              ? 'font-medium text-amber-800'
                              : 'text-slate-600'
                        }`}
                      >
                        {formatDate(document.expiry_date)}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <RowActions
                          hasFile={Boolean(document.file_path)}
                          onView={() => openFile(document, 'view')}
                          onDownload={() => openFile(document, 'download')}
                          onEdit={() => setFormState({ mode: 'edit', document })}
                          onDelete={() => setDeleteTarget(document)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {documents.map((document) => {
              const status = getWorkerDocumentDisplayStatus(document)
              return (
                <li key={document.id} className={`p-5 ${rowHighlight[status] ?? ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium">{document.document_type}</div>
                      <div className="text-xs text-slate-500">
                        <FileName document={document} />
                      </div>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Issued</dt>
                      <dd className="font-medium">{formatDate(document.issue_date)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Expires</dt>
                      <dd className="font-medium">{formatDate(document.expiry_date)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <RowActions
                      hasFile={Boolean(document.file_path)}
                      onView={() => openFile(document, 'view')}
                      onDownload={() => openFile(document, 'download')}
                      onEdit={() => setFormState({ mode: 'edit', document })}
                      onDelete={() => setDeleteTarget(document)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {formState && (
        <WorkerDocumentFormModal
          key={formState.mode === 'edit' ? formState.document.id : 'add'}
          scope={scope}
          existing={formState.mode === 'edit' ? formState.document : null}
          onSaved={handleSaved}
          onClose={() => setFormState(null)}
        />
      )}

      {deleteTarget && (
        <DeleteWorkerDocumentModal
          document={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </section>
  )
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClasses[status]}`}
    >
      {(status === 'expired' || status === 'expiring') && (
        <span aria-hidden="true">!</span>
      )}
      {documentStatusLabels[status]}
    </span>
  )
}

function FileName({ document }: { document: WorkerDocument }) {
  if (document.file_path) {
    return (
      <span className="block truncate" title={document.file_name ?? undefined}>
        📄 {document.file_name ?? 'Uploaded file'}
      </span>
    )
  }
  return <span className="text-slate-400">No file uploaded</span>
}

function RowActions({
  hasFile,
  onView,
  onDownload,
  onEdit,
  onDelete,
}: {
  hasFile: boolean
  onView: () => void
  onDownload: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-2">
      {hasFile && (
        <>
          <button
            onClick={onView}
            className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            View
          </button>
          <button
            onClick={onDownload}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            Download
          </button>
        </>
      )}
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

type FormErrors = Partial<
  Record<'typeChoice' | 'customType' | 'expiryDate' | 'file', string>
>

function initialTypeFields(existing: WorkerDocument | null) {
  if (!existing) return { typeChoice: '', customType: '' }

  const known = (WORKER_DOCUMENT_TYPES as readonly string[]).includes(
    existing.document_type
  )
  if (known) return { typeChoice: existing.document_type, customType: '' }

  return {
    typeChoice: OTHER_DOCUMENT_TYPE,
    customType:
      existing.document_type === OTHER_DOCUMENT_TYPE ? '' : existing.document_type,
  }
}

function WorkerDocumentFormModal({
  scope,
  existing,
  onSaved,
  onClose,
}: {
  scope: Scope
  existing: WorkerDocument | null
  onSaved: (document: WorkerDocument, warning: string | null, isAdd: boolean) => void
  onClose: () => void
}) {
  const initialType = initialTypeFields(existing)
  const [typeChoice, setTypeChoice] = useState(initialType.typeChoice)
  const [customType, setCustomType] = useState(initialType.customType)
  const [issueDate, setIssueDate] = useState(existing?.issue_date ?? '')
  const [expiryDate, setExpiryDate] = useState(existing?.expiry_date ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [stage, setStage] = useState<WorkerDocumentSaveStage | null>(null)
  const [checkingFile, setCheckingFile] = useState(false)

  const saving = stage !== null
  const isOther = typeChoice === OTHER_DOCUMENT_TYPE
  const existingFile = existing?.file_path
    ? (existing.file_name ?? 'Uploaded file')
    : null
  const previewStatus = calculateDocumentStatus(expiryDate || null)

  function clearError(field: keyof FormErrors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    // Clear the input so choosing the same file again still triggers a change.
    event.target.value = ''
    if (!chosen) return

    setCheckingFile(true)
    const result = await validateDocumentFile(chosen)
    setCheckingFile(false)

    if (!result.ok) {
      setFile(null)
      setErrors((prev) => ({ ...prev, file: result.error }))
      return
    }
    setFile(chosen)
    clearError('file')
  }

  function validate(): FormErrors {
    const next: FormErrors = {}
    if (!typeChoice) next.typeChoice = 'Choose a document type.'
    if (isOther && customType.trim().length > 100) {
      next.customType = 'Keep the document type to 100 characters or fewer.'
    }
    if (issueDate && expiryDate && expiryDate < issueDate) {
      next.expiryDate = 'Expiry date cannot be before the issue date.'
    }
    return next
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)
    if (checkingFile) return

    const validationErrors = validate()
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    const documentType = isOther
      ? customType.trim() || OTHER_DOCUMENT_TYPE
      : typeChoice

    setStage('saving')
    try {
      const result = await saveWorkerDocument({
        scope,
        existing,
        values: { documentType, issueDate, expiryDate, file },
        onStage: setStage,
      })
      if (!result.ok) {
        setSubmitError(result.error)
        return
      }
      onSaved(result.document, result.warning, existing === null)
    } catch {
      setSubmitError('Something went wrong. Please check your connection and try again.')
    } finally {
      setStage(null)
    }
  }

  return (
    <Modal
      title={existing ? 'Edit Worker Document' : 'Add Worker Document'}
      titleId="worker-document-form-title"
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

          <FormField
            id="typeChoice"
            label="Document Type"
            required
            hint="Categories help you organise documents. Requirements vary by project and client."
            error={errors.typeChoice}
          >
            <select
              id="typeChoice"
              value={typeChoice}
              onChange={(e) => {
                setTypeChoice(e.target.value)
                clearError('typeChoice')
              }}
              disabled={saving}
              aria-invalid={errors.typeChoice ? true : undefined}
              aria-describedby={errors.typeChoice ? 'typeChoice-error' : 'typeChoice-hint'}
              className={inputClasses(Boolean(errors.typeChoice))}
            >
              <option value="" disabled>
                Select a document type
              </option>
              {WORKER_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
              <option value={OTHER_DOCUMENT_TYPE}>Other</option>
            </select>
          </FormField>

          {isOther && (
            <FormField
              id="customType"
              label="Describe the document"
              hint='Optional. Saved as "Other" if left blank.'
              error={errors.customType}
            >
              <input
                id="customType"
                value={customType}
                onChange={(e) => {
                  setCustomType(e.target.value)
                  clearError('customType')
                }}
                disabled={saving}
                placeholder="e.g. Confined Space Entry"
                aria-invalid={errors.customType ? true : undefined}
                aria-describedby={errors.customType ? 'customType-error' : 'customType-hint'}
                className={inputClasses(Boolean(errors.customType))}
              />
            </FormField>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="issueDate" label="Issue Date">
              <input
                id="issueDate"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                disabled={saving}
                className={inputClasses(false)}
              />
            </FormField>

            <FormField id="expiryDate" label="Expiry Date" error={errors.expiryDate}>
              <input
                id="expiryDate"
                type="date"
                value={expiryDate}
                onChange={(e) => {
                  setExpiryDate(e.target.value)
                  clearError('expiryDate')
                }}
                disabled={saving}
                aria-invalid={errors.expiryDate ? true : undefined}
                aria-describedby={errors.expiryDate ? 'expiryDate-error' : undefined}
                className={inputClasses(Boolean(errors.expiryDate))}
              />
            </FormField>
          </div>

          <FormField
            id="file"
            label={existingFile ? 'Document File' : 'Upload File'}
            hint="Optional. PDF, JPG or PNG, up to 10 MB."
            error={errors.file}
          >
            <div
              className={`rounded-lg border border-dashed px-4 py-4 ${
                errors.file ? 'border-red-300' : 'border-slate-300'
              }`}
            >
              {existingFile && (
                <p className="mb-3 truncate text-sm text-slate-600">
                  <span className="text-slate-500">Current file:</span>{' '}
                  <span className={file ? 'line-through' : 'font-medium'}>
                    {existingFile}
                  </span>
                </p>
              )}

              {file ? (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-blue-800">
                    📄 {file.name}{' '}
                    <span className="text-blue-600/70">({formatFileSize(file.size)})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null)
                      clearError('file')
                    }}
                    disabled={saving}
                    className="shrink-0 text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label
                  className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm ${
                    saving || checkingFile
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  <input
                    id="file"
                    type="file"
                    accept={DOCUMENT_FILE_ACCEPT}
                    onChange={handleFileChange}
                    disabled={saving || checkingFile}
                    aria-invalid={errors.file ? true : undefined}
                    aria-describedby={errors.file ? 'file-error' : 'file-hint'}
                    className="sr-only"
                  />
                  {checkingFile
                    ? 'Checking file…'
                    : existingFile
                      ? 'Replace file'
                      : 'Choose file'}
                </label>
              )}

              {existingFile && file && (
                <p className="mt-2 text-xs text-slate-500">
                  The current file will be replaced when you save.
                </p>
              )}
            </div>
          </FormField>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-500">Status (calculated from expiry date)</span>
            <StatusBadge status={previewStatus} />
          </div>
          <p className="text-xs text-slate-500">
            Documents expiring within {EXPIRING_WINDOW_DAYS} days are marked
            Expiring. Documents without an expiry date are marked Valid.
          </p>
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
            disabled={saving || checkingFile}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {stage ? saveStageLabels[stage] : existing ? 'Save Changes' : 'Add Document'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteWorkerDocumentModal({
  document,
  onConfirm,
  onClose,
}: {
  document: WorkerDocument
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
      title="Delete document?"
      titleId="delete-worker-document-title"
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
          Are you sure you want to delete{' '}
          <span className="font-medium text-slate-900">{document.document_type}</span>
          {document.file_name ? ` (${document.file_name})` : ''}?
          {document.file_path && ' The uploaded file will also be permanently deleted.'}{' '}
          This cannot be undone.
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
          {deleting ? 'Deleting…' : 'Delete Document'}
        </button>
      </div>
    </Modal>
  )
}
