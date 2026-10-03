'use client'

import {
  useEffect,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SubmitEvent,
} from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRequireProfile } from '@/lib/useRequireProfile'
import {
  calculateDocumentStatus,
  documentStatusLabels,
  EXPIRING_WINDOW_DAYS,
  type DocumentStatus,
} from '@/lib/documentStatus'
import {
  buildDocumentFilePath,
  createDocumentFileUrl,
  DOCUMENT_FILE_ACCEPT,
  DOCUMENTS_BUCKET,
  formatFileSize,
  isCompanyDocumentFilePath,
  removeDocumentFile,
  validateDocumentFile,
} from '@/lib/documentFiles'

type CompanyDocument = {
  id: string
  company_id: string
  document_type: string
  file_name: string | null
  file_path: string | null
  issue_date: string | null
  expiry_date: string | null
  status: DocumentStatus | null
  created_at: string
  updated_at: string | null
}

type DocumentFormValues = {
  documentType: string
  issueDate: string
  expiryDate: string
  file: File | null
}

type DocumentFormErrors = Partial<Record<keyof DocumentFormValues, string>>

type Feedback = { tone: 'success' | 'warning' | 'error'; message: string }

type SaveStage = 'uploading' | 'saving' | 'cleaning'

const saveStageLabels: Record<SaveStage, string> = {
  uploading: 'Uploading file…',
  saving: 'Saving document…',
  cleaning: 'Removing previous file…',
}

type FormState =
  | { mode: 'add' }
  | { mode: 'edit'; document: CompanyDocument }
  | null

const DOCUMENT_COLUMNS =
  'id, company_id, document_type, file_name, file_path, issue_date, expiry_date, status, created_at, updated_at'

const DOCUMENT_TYPE_SUGGESTIONS = [
  'B-BBEE Certificate',
  'CIDB Registration',
  'CIPC Registration Certificate',
  'COIDA Letter of Good Standing',
  'Health and Safety File',
  'Public Liability Insurance',
  'SARS Tax Compliance Status',
  'UIF Registration',
]

const emptyFormValues: DocumentFormValues = {
  documentType: '',
  issueDate: '',
  expiryDate: '',
  file: null,
}

const statusBadgeClasses: Record<DocumentStatus, string> = {
  valid: 'bg-emerald-50 text-emerald-700',
  expiring: 'bg-amber-50 text-amber-700',
  expired: 'bg-red-50 text-red-700',
  missing: 'bg-slate-100 text-slate-600',
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

// The stored status is only recalculated when a document is saved, so derive
// it from the expiry date for display. "missing" is never derived, so keep it.
function getDisplayStatus(document: CompanyDocument): DocumentStatus {
  if (document.status === 'missing') return 'missing'
  return calculateDocumentStatus(document.expiry_date)
}

// Soonest expiry first; documents without an expiry date last.
function sortDocuments(documents: CompanyDocument[]) {
  return [...documents].sort((a, b) => {
    if (a.expiry_date === b.expiry_date) {
      return a.document_type.localeCompare(b.document_type)
    }
    if (!a.expiry_date) return 1
    if (!b.expiry_date) return -1
    return a.expiry_date.localeCompare(b.expiry_date)
  })
}

function validateForm(values: DocumentFormValues): DocumentFormErrors {
  const errors: DocumentFormErrors = {}

  if (!values.documentType.trim()) {
    errors.documentType = 'Document type is required.'
  }

  if (
    values.issueDate &&
    values.expiryDate &&
    values.expiryDate < values.issueDate
  ) {
    errors.expiryDate = 'Expiry date cannot be before the issue date.'
  }

  return errors
}

function toDocumentFields(values: DocumentFormValues) {
  const expiryDate = values.expiryDate || null

  return {
    document_type: values.documentType.trim(),
    issue_date: values.issueDate || null,
    expiry_date: expiryDate,
    status: calculateDocumentStatus(expiryDate),
  }
}

export default function DocumentsPage() {
  const auth = useRequireProfile()
  const companyId = auth.status === 'ready' ? auth.profile.company_id : null

  const [documents, setDocuments] = useState<CompanyDocument[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [formState, setFormState] = useState<FormState>(null)
  const [deleteTarget, setDeleteTarget] = useState<CompanyDocument | null>(
    null
  )
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function loadDocuments() {
      const { data, error } = await supabase
        .from('company_documents')
        .select(DOCUMENT_COLUMNS)
        .eq('company_id', companyId)
        .overrideTypes<CompanyDocument[], { merge: false }>()
      if (cancelled) return

      if (error) {
        setLoadError("We couldn't load your documents. Please try again.")
        return
      }

      setLoadError(null)
      setDocuments(sortDocuments(data ?? []))
    }

    loadDocuments()

    return () => {
      cancelled = true
    }
  }, [companyId, reloadKey])

  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 5000)
    return () => clearTimeout(timer)
  }, [feedback])

  function retryLoad() {
    setLoadError(null)
    setDocuments(null)
    setReloadKey((key) => key + 1)
  }

  // Order of operations keeps the database from pointing at a missing file:
  // upload the new file first, then save the row, then remove any replaced
  // file. If saving fails, the newly uploaded file is removed again.
  async function saveDocument(
    values: DocumentFormValues,
    onStage: (stage: SaveStage) => void
  ): Promise<string | null> {
    if (!companyId || !formState) return 'Your session is not ready yet.'

    const isAdd = formState.mode === 'add'
    // New documents get their ID up front so the file can be stored under it.
    const documentId = isAdd ? crypto.randomUUID() : formState.document.id
    const previousPath = isAdd ? null : formState.document.file_path

    let uploaded: { path: string; name: string } | null = null

    if (values.file) {
      const check = await validateDocumentFile(values.file)
      if (!check.ok) return check.error

      const path = buildDocumentFilePath(companyId, documentId, check.kind)
      onStage('uploading')
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, values.file, {
          contentType: check.contentType,
          upsert: false,
        })

      if (uploadError) {
        return "We couldn't upload your file, so nothing was saved. Please try again."
      }
      uploaded = { path, name: values.file.name.slice(0, 255) }
    }

    const fields = {
      ...toDocumentFields(values),
      ...(uploaded && { file_name: uploaded.name, file_path: uploaded.path }),
    }

    onStage('saving')
    let saved: CompanyDocument | null = null
    let saveError: string | null = null

    if (isAdd) {
      const { data, error } = await supabase
        .from('company_documents')
        .insert({ ...fields, id: documentId, company_id: companyId })
        .select(DOCUMENT_COLUMNS)
        .single<CompanyDocument>()

      if (error || !data) {
        saveError = "We couldn't add this document. Please try again."
      } else {
        saved = data
      }
    } else {
      const { data, error } = await supabase
        .from('company_documents')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', documentId)
        .eq('company_id', companyId)
        .select(DOCUMENT_COLUMNS)
        .maybeSingle<CompanyDocument>()

      if (error) {
        saveError = "We couldn't save your changes. Please try again."
      } else if (!data) {
        saveError = "This document couldn't be found. It may have been deleted."
      } else {
        saved = data
      }
    }

    if (!saved) {
      if (uploaded) {
        onStage('cleaning')
        await removeDocumentFile(uploaded.path)
      }
      return saveError
    }

    const savedDocument = saved
    setDocuments((prev) =>
      sortDocuments(
        isAdd
          ? [...(prev ?? []), savedDocument]
          : (prev ?? []).map((d) => (d.id === savedDocument.id ? savedDocument : d))
      )
    )

    let feedbackMessage: Feedback = {
      tone: 'success',
      message: `${savedDocument.document_type} was ${isAdd ? 'added' : 'updated'}.`,
    }

    if (uploaded && previousPath && previousPath !== uploaded.path) {
      onStage('cleaning')
      const removed =
        isCompanyDocumentFilePath(previousPath, companyId) &&
        (await removeDocumentFile(previousPath))
      if (!removed) {
        feedbackMessage = {
          tone: 'warning',
          message: `${savedDocument.document_type} was updated with the new file, but the previous file couldn't be removed from storage.`,
        }
      }
    }

    setFeedback(feedbackMessage)
    setFormState(null)
    return null
  }

  // The stored file is removed first. If that fails the record is kept, so
  // the user is never told a document is gone while its file remains.
  async function deleteDocument(document: CompanyDocument): Promise<string | null> {
    if (!companyId) return 'Your session is not ready yet.'

    if (document.file_path) {
      if (!isCompanyDocumentFilePath(document.file_path, companyId, document.id)) {
        return "This document's file location is invalid, so it can't be removed safely. Please contact support."
      }

      const removed = await removeDocumentFile(document.file_path)
      if (!removed) {
        return "We couldn't delete the attached file, so the document was kept. Please try again."
      }
    }

    const { data, error } = await supabase
      .from('company_documents')
      .delete()
      .eq('id', document.id)
      .eq('company_id', companyId)
      .select('id')

    if (error || !data || data.length === 0) {
      return document.file_path
        ? "The attached file was deleted, but the document record couldn't be removed. Please try again."
        : "We couldn't delete this document. Please try again."
    }

    setDocuments((prev) => (prev ?? []).filter((d) => d.id !== document.id))
    setDeleteTarget(null)
    setFeedback({
      tone: 'success',
      message: `${document.document_type} was deleted.`,
    })
    return null
  }

  async function openDocumentFile(
    document: CompanyDocument,
    action: 'view' | 'download'
  ) {
    if (!companyId || !document.file_path) return

    if (!isCompanyDocumentFilePath(document.file_path, companyId, document.id)) {
      setFeedback({
        tone: 'error',
        message: "This document's file location is invalid. Please contact support.",
      })
      return
    }

    // Open the tab before the request so pop-up blockers allow it.
    const viewer = action === 'view' ? window.open('', '_blank') : null
    if (viewer) viewer.opener = null

    const url = await createDocumentFileUrl(
      document.file_path,
      action === 'download' ? (document.file_name ?? undefined) : undefined
    )

    if (!url) {
      viewer?.close()
      setFeedback({
        tone: 'error',
        message: "We couldn't open this file. It may have been removed, or your session may have expired.",
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

  if (auth.status === 'loading') {
    return (
      <CenteredScreen>
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">Loading documents…</p>
      </CenteredScreen>
    )
  }

  if (auth.status === 'error') {
    return (
      <CenteredScreen>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold">{auth.title}</h1>
          <p className="mt-2 text-sm text-slate-500">{auth.message}</p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Go to sign in
          </Link>
        </div>
      </CenteredScreen>
    )
  }

  const documentCount = documents?.length ?? 0

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-6 lg:px-8">
        <Link href="/" className="block">
          <div className="text-xl font-bold tracking-tight">
            Compliance<span className="text-blue-600">Ready</span>
          </div>
          <div className="text-xs text-slate-400">SOUTH AFRICA</div>
        </Link>

        <Link
          href="/"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        >
          ← Back to Dashboard
        </Link>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <nav className="mb-2 text-sm text-slate-500">
              <Link href="/" className="hover:text-slate-900">
                Dashboard
              </Link>
              <span className="mx-2">/</span>
              <span className="text-slate-900">Company Documents</span>
            </nav>
            <h1 className="text-2xl font-bold">Company Documents</h1>
            <p className="mt-1 text-slate-500">
              {documents === null
                ? 'Loading documents…'
                : `${documentCount} ${documentCount === 1 ? 'document' : 'documents'} on file`}
            </p>
          </div>

          <button
            onClick={() => setFormState({ mode: 'add' })}
            disabled={documents === null}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Add Document
          </button>
        </div>

        {feedback && (
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
              onClick={() => setFeedback(null)}
              aria-label="Dismiss message"
              className="opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
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
              <h2 className="mt-4 font-semibold">No company documents yet.</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                Add your company&apos;s compliance documents to track their
                expiry dates and keep your business site-ready.
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
                      <th className="px-6 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {documents.map((document) => (
                      <tr key={document.id} className="hover:bg-slate-50/60">
                        <td className="px-6 py-4 font-medium">
                          {document.document_type}
                        </td>
                        <td className="max-w-xs px-6 py-4 text-slate-600">
                          <FileNameCell document={document} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                          {formatDate(document.issue_date)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                          {formatDate(document.expiry_date)}
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={getDisplayStatus(document)} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <RowActions
                            hasFile={Boolean(document.file_path)}
                            onView={() => openDocumentFile(document, 'view')}
                            onDownload={() =>
                              openDocumentFile(document, 'download')
                            }
                            onEdit={() =>
                              setFormState({ mode: 'edit', document })
                            }
                            onDelete={() => setDeleteTarget(document)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {documents.map((document) => (
                  <li key={document.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium">
                          {document.document_type}
                        </div>
                        <div className="text-xs text-slate-500">
                          <FileNameCell document={document} />
                        </div>
                      </div>
                      <StatusBadge status={getDisplayStatus(document)} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-slate-500">Issued</dt>
                        <dd className="font-medium">
                          {formatDate(document.issue_date)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Expires</dt>
                        <dd className="font-medium">
                          {formatDate(document.expiry_date)}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3">
                      <RowActions
                        hasFile={Boolean(document.file_path)}
                        onView={() => openDocumentFile(document, 'view')}
                        onDownload={() => openDocumentFile(document, 'download')}
                        onEdit={() => setFormState({ mode: 'edit', document })}
                        onDelete={() => setDeleteTarget(document)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {formState && (
        <DocumentFormModal
          key={formState.mode === 'edit' ? formState.document.id : 'add'}
          mode={formState.mode}
          initialValues={
            formState.mode === 'edit'
              ? {
                  documentType: formState.document.document_type,
                  issueDate: formState.document.issue_date ?? '',
                  expiryDate: formState.document.expiry_date ?? '',
                  file: null,
                }
              : emptyFormValues
          }
          existingFile={
            formState.mode === 'edit' && formState.document.file_path
              ? formState.document.file_name ?? 'Uploaded file'
              : null
          }
          onSubmit={saveDocument}
          onClose={() => setFormState(null)}
        />
      )}

      {deleteTarget && (
        <DeleteDocumentModal
          document={deleteTarget}
          onConfirm={() => deleteDocument(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </main>
  )
}

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 text-slate-900">
      <div className="mb-8 text-center">
        <div className="text-2xl font-bold tracking-tight">
          Compliance<span className="text-blue-600">Ready</span>
        </div>
        <div className="text-xs tracking-widest text-slate-400">
          SOUTH AFRICA
        </div>
      </div>
      {children}
    </main>
  )
}

function FileNameCell({ document }: { document: CompanyDocument }) {
  if (document.file_path) {
    return (
      <span className="block truncate" title={document.file_name ?? undefined}>
        📄 {document.file_name ?? 'Uploaded file'}
      </span>
    )
  }

  return (
    <span className="block truncate">
      {document.file_name && (
        <span className="mr-1 text-slate-600">{document.file_name}</span>
      )}
      <span className="text-slate-400">No file uploaded</span>
    </span>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
    />
  )
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClasses[status]}`}
    >
      {documentStatusLabels[status]}
    </span>
  )
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

function Modal({
  title,
  titleId,
  onClose,
  dismissable,
  children,
}: {
  title: string
  titleId: string
  onClose: () => void
  dismissable: boolean
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
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
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

function DocumentFormModal({
  mode,
  initialValues,
  existingFile,
  onSubmit,
  onClose,
}: {
  mode: 'add' | 'edit'
  initialValues: DocumentFormValues
  existingFile: string | null
  onSubmit: (
    values: DocumentFormValues,
    onStage: (stage: SaveStage) => void
  ) => Promise<string | null>
  onClose: () => void
}) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<DocumentFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [stage, setStage] = useState<SaveStage | null>(null)
  const [checkingFile, setCheckingFile] = useState(false)
  const saving = stage !== null

  const previewStatus = calculateDocumentStatus(values.expiryDate || null)

  function updateField(
    field: Exclude<keyof DocumentFormValues, 'file'>,
    value: string
  ) {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Clear the input so choosing the same file again still triggers a change.
    event.target.value = ''
    if (!file) return

    setCheckingFile(true)
    const result = await validateDocumentFile(file)
    setCheckingFile(false)

    if (!result.ok) {
      setValues((prev) => ({ ...prev, file: null }))
      setErrors((prev) => ({ ...prev, file: result.error }))
      return
    }

    setValues((prev) => ({ ...prev, file }))
    setErrors((prev) => ({ ...prev, file: undefined }))
  }

  function clearFile() {
    setValues((prev) => ({ ...prev, file: null }))
    setErrors((prev) => ({ ...prev, file: undefined }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)
    if (checkingFile) return

    const validationErrors = validateForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setStage('saving')
    try {
      const error = await onSubmit(values, setStage)
      if (error) setSubmitError(error)
    } catch {
      setSubmitError('Something went wrong. Please check your connection and try again.')
    } finally {
      setStage(null)
    }
  }

  return (
    <Modal
      title={mode === 'add' ? 'Add Document' : 'Edit Document'}
      titleId="document-form-title"
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
            id="documentType"
            label="Document Type"
            required
            error={errors.documentType}
          >
            <input
              id="documentType"
              list="document-type-suggestions"
              value={values.documentType}
              onChange={(e) => updateField('documentType', e.target.value)}
              disabled={saving}
              placeholder="e.g. COIDA Letter of Good Standing"
              aria-invalid={errors.documentType ? true : undefined}
              aria-describedby={
                errors.documentType ? 'documentType-error' : undefined
              }
              className={inputClasses(Boolean(errors.documentType))}
            />
            <datalist id="document-type-suggestions">
              {DOCUMENT_TYPE_SUGGESTIONS.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </FormField>

          <FormField
            id="file"
            label={existingFile ? 'Document File' : 'Upload File'}
            hint="PDF, JPG or PNG, up to 10 MB."
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
                  <span className={values.file ? 'line-through' : 'font-medium'}>
                    {existingFile}
                  </span>
                </p>
              )}

              {values.file ? (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-blue-800">
                    📄 {values.file.name}{' '}
                    <span className="text-blue-600/70">
                      ({formatFileSize(values.file.size)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={clearFile}
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

              {existingFile && values.file && (
                <p className="mt-2 text-xs text-slate-500">
                  The current file will be replaced when you save.
                </p>
              )}
            </div>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="issueDate" label="Issue Date">
              <input
                id="issueDate"
                type="date"
                value={values.issueDate}
                onChange={(e) => updateField('issueDate', e.target.value)}
                disabled={saving}
                className={inputClasses(false)}
              />
            </FormField>

            <FormField
              id="expiryDate"
              label="Expiry Date"
              error={errors.expiryDate}
            >
              <input
                id="expiryDate"
                type="date"
                value={values.expiryDate}
                onChange={(e) => updateField('expiryDate', e.target.value)}
                disabled={saving}
                aria-invalid={errors.expiryDate ? true : undefined}
                aria-describedby={
                  errors.expiryDate ? 'expiryDate-error' : undefined
                }
                className={inputClasses(Boolean(errors.expiryDate))}
              />
            </FormField>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-500">
              Status (calculated from expiry date)
            </span>
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
            {stage
              ? saveStageLabels[stage]
              : mode === 'add'
                ? 'Add Document'
                : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteDocumentModal({
  document,
  onConfirm,
  onClose,
}: {
  document: CompanyDocument
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
      titleId="delete-document-title"
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
          <span className="font-medium text-slate-900">
            {document.document_type}
          </span>
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

function FormField({
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

function inputClasses(hasError: boolean) {
  return `block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 ${
    hasError
      ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
      : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
  }`
}
