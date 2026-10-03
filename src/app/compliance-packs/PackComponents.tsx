'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { documentStatusLabels, type DocumentStatus } from '@/lib/documentStatus'
import {
  createPackDownloadUrl,
  formatIsoDate,
  generateCompliancePack,
  isDefaultSelected,
  loadPackCandidates,
  MAX_PACK_BYTES,
  PACK_DISCLAIMER,
  type CompliancePack,
  type GenerateProgress,
  type PackCandidates,
  type PackDocument,
  type PackProject,
  type PackStatus,
} from '@/lib/compliancePacks'
import { FormField, inputClasses, Modal, Spinner } from '@/app/workers/WorkerComponents'

const packStatusStyles: Record<PackStatus, { label: string; className: string }> = {
  generating: { label: 'Generating', className: 'bg-blue-50 text-blue-700' },
  generated: { label: 'Generated', className: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
}

const documentStatusClasses: Record<DocumentStatus, string> = {
  valid: 'bg-emerald-50 text-emerald-700',
  expiring: 'bg-amber-100 text-amber-800',
  expired: 'bg-red-100 text-red-700',
  missing: 'bg-slate-100 text-slate-600',
}

export function PackStatusBadge({ status }: { status: PackStatus }) {
  const style = packStatusStyles[status] ?? packStatusStyles.failed
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  )
}

/** Downloads a pack through a short-lived signed URL. Returns an error message on failure. */
export async function downloadPack(
  companyId: string,
  pack: CompliancePack
): Promise<string | null> {
  const url = await createPackDownloadUrl(companyId, pack)
  if (!url) {
    return "We couldn't download this pack. It may have been removed, or your session may have expired."
  }
  window.location.assign(url)
  return null
}

function progressLabel(progress: GenerateProgress | null) {
  if (!progress) return 'Generating…'
  switch (progress.stage) {
    case 'downloading':
      return `Collecting files (${progress.done + 1} of ${progress.total})…`
    case 'zipping':
      return 'Building pack…'
    case 'uploading':
      return 'Saving pack…'
    case 'saving':
      return 'Recording pack…'
    case 'cleaning':
      return 'Cleaning up…'
  }
}

/**
 * Pack creation for one project. The project must already have been loaded
 * through the company-scoped project query. companyId/userId come from the
 * signed-in user's profile.
 */
export function GeneratePackModal({
  companyId,
  userId,
  userName,
  project,
  onGenerated,
  onClose,
}: {
  companyId: string
  userId: string
  userName: string
  project: PackProject
  onGenerated: (pack: CompliancePack) => void
  onClose: () => void
}) {
  const [candidates, setCandidates] = useState<PackCandidates | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [packName, setPackName] = useState(`${project.project_name} Compliance Pack`)
  const [nameError, setNameError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<GenerateProgress | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedPack, setGeneratedPack] = useState<CompliancePack | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPackCandidates(companyId, project.id).then((result) => {
      if (cancelled) return
      if (!result) {
        setLoadError(true)
        return
      }
      setCandidates(result)
      const all = [...result.companyDocuments, ...result.workers.flatMap((w) => w.documents)]
      setSelected(new Set(all.filter(isDefaultSelected).map((d) => d.key)))
    })
    return () => {
      cancelled = true
    }
  }, [companyId, project.id])

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function setMany(documents: PackDocument[], include: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const d of documents) {
        if (!d.filePath) continue
        if (include) next.add(d.key)
        else next.delete(d.key)
      }
      return next
    })
  }

  async function handleGenerate() {
    if (!candidates) return
    setError(null)

    const trimmed = packName.trim()
    if (!trimmed) {
      setNameError('Pack name is required.')
      return
    }
    if (trimmed.length > 150) {
      setNameError('Pack name must be 150 characters or fewer.')
      return
    }

    setGenerating(true)
    try {
      const result = await generateCompliancePack({
        companyId,
        userId,
        generatedByName: userName,
        project,
        packName: trimmed,
        candidates,
        selectedKeys: selected,
        onProgress: setProgress,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setGeneratedPack(result.pack)
      onGenerated(result.pack)
    } catch {
      setError('Something went wrong while generating the pack. Nothing was recorded. Please try again.')
    } finally {
      setGenerating(false)
      setProgress(null)
    }
  }

  const allDocuments = candidates
    ? [...candidates.companyDocuments, ...candidates.workers.flatMap((w) => w.documents)]
    : []
  const selectedDocuments = allDocuments.filter((d) => selected.has(d.key) && d.filePath)
  const selectedExpired = selectedDocuments.filter(
    (d) => d.status === 'expired' || d.status === 'missing'
  ).length
  const selectedExpiring = selectedDocuments.filter((d) => d.status === 'expiring').length

  if (generatedPack) {
    return (
      <Modal title="Compliance pack generated" titleId="pack-done-title" onClose={onClose} dismissable>
        <div className="space-y-4 p-6 text-center text-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-xl text-emerald-600">
            ✓
          </div>
          <p className="font-medium text-slate-900">{generatedPack.pack_name}</p>
          <p className="text-slate-500">
            The pack was saved privately and is available from Compliance Packs.
          </p>
          {downloadError && <p className="text-red-600">{downloadError}</p>}
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button
              onClick={async () => setDownloadError(await downloadPack(companyId, generatedPack))}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Download ZIP
            </button>
            <Link
              href="/compliance-packs"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View all packs
            </Link>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Generate Compliance Pack"
      titleId="generate-pack-title"
      onClose={onClose}
      dismissable={!generating}
      size="xl"
    >
      <div className="space-y-5 p-6">
        <p className="text-sm text-slate-500">
          For <span className="font-medium text-slate-900">{project.project_name}</span>.
          Choose the documents to include. Only documents with an uploaded file
          can be added to the ZIP.
        </p>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <FormField id="packName" label="Pack Name" required error={nameError ?? undefined}>
          <input
            id="packName"
            value={packName}
            onChange={(e) => {
              setPackName(e.target.value)
              setNameError(null)
            }}
            disabled={generating}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'packName-error' : undefined}
            className={inputClasses(Boolean(nameError))}
          />
        </FormField>

        {loadError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            We couldn&apos;t load the documents for this project. Close this
            window and try again.
          </p>
        ) : !candidates ? (
          <div className="flex flex-col items-center py-8">
            <Spinner />
            <p className="mt-4 text-sm text-slate-500">Loading documents…</p>
          </div>
        ) : (
          <>
            <DocumentGroup
              title="Company Documents"
              documents={candidates.companyDocuments}
              selected={selected}
              disabled={generating}
              onToggle={toggle}
              onSetAll={setMany}
              emptyText="No company documents recorded."
            />

            <div>
              <h3 className="text-sm font-semibold">Assigned Workers</h3>
              {candidates.workers.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  No workers are assigned to this project.
                </p>
              ) : (
                <div className="mt-3 space-y-4">
                  {candidates.workers.map((worker) => (
                    <DocumentGroup
                      key={worker.id}
                      title={worker.fullName}
                      subtitle={worker.trade ?? undefined}
                      documents={worker.documents}
                      selected={selected}
                      disabled={generating}
                      onToggle={toggle}
                      onSetAll={setMany}
                      emptyText="No documents recorded for this worker."
                      nested
                    />
                  ))}
                </div>
              )}
            </div>

            {selectedExpired > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <strong>
                  {selectedExpired} expired {selectedExpired === 1 ? 'document is' : 'documents are'} selected.
                </strong>{' '}
                They will be included and clearly marked as Expired in the pack&apos;s
                README. Recipients may not accept expired documents as current
                evidence.
              </div>
            )}
            {selectedExpiring > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {selectedExpiring} selected {selectedExpiring === 1 ? 'document expires' : 'documents expire'} within
                30 days and will be marked as Expiring.
              </div>
            )}

            <p className="text-xs text-slate-500">
              {PACK_DISCLAIMER} Packs are limited to {MAX_PACK_BYTES / (1024 * 1024)} MB
              of files. Keep this window open while the pack is generated.
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-slate-500">
          {selectedDocuments.length} {selectedDocuments.length === 1 ? 'document' : 'documents'} selected
        </span>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !candidates || selectedDocuments.length === 0}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {generating ? progressLabel(progress) : 'Generate Pack'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function DocumentGroup({
  title,
  subtitle,
  documents,
  selected,
  disabled,
  onToggle,
  onSetAll,
  emptyText,
  nested = false,
}: {
  title: string
  subtitle?: string
  documents: PackDocument[]
  selected: Set<string>
  disabled: boolean
  onToggle: (key: string) => void
  onSetAll: (documents: PackDocument[], include: boolean) => void
  emptyText: string
  nested?: boolean
}) {
  const withFiles = documents.filter((d) => d.filePath)
  const selectedCount = withFiles.filter((d) => selected.has(d.key)).length

  return (
    <div className={nested ? 'rounded-xl border border-slate-200' : ''}>
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${nested ? 'border-b border-slate-200 px-4 py-3' : 'mb-2'}`}
      >
        <div>
          <h3 className={nested ? 'text-sm font-medium' : 'text-sm font-semibold'}>{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {withFiles.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-500">
              {selectedCount} of {withFiles.length} selected
            </span>
            <button
              type="button"
              onClick={() => onSetAll(withFiles, true)}
              disabled={disabled}
              className="font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onSetAll(withFiles, false)}
              disabled={disabled}
              className="font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              None
            </button>
          </div>
        )}
      </div>

      {documents.length === 0 ? (
        <p className={`text-sm text-slate-500 ${nested ? 'px-4 py-3' : ''}`}>{emptyText}</p>
      ) : (
        <ul
          className={`divide-y divide-slate-100 ${nested ? '' : 'rounded-xl border border-slate-200'}`}
        >
          {documents.map((document) => (
            <DocumentRow
              key={document.key}
              document={document}
              checked={selected.has(document.key)}
              disabled={disabled}
              onToggle={() => onToggle(document.key)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function DocumentRow({
  document,
  checked,
  disabled,
  onToggle,
}: {
  document: PackDocument
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const hasFile = Boolean(document.filePath)
  const inputId = `pack-${document.key}`

  return (
    <li>
      <label
        htmlFor={inputId}
        className={`flex items-start gap-3 px-4 py-3 text-sm ${
          hasFile ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed bg-slate-50/60'
        }`}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={hasFile && checked}
          disabled={!hasFile || disabled}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="min-w-0 flex-1">
          <span className={`block font-medium ${hasFile ? '' : 'text-slate-500'}`}>
            {document.documentType}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {hasFile ? document.fileName ?? 'Uploaded file' : 'No file uploaded — cannot be included'}
            {' · '}
            {document.expiryDate ? `Expires ${formatIsoDate(document.expiryDate)}` : 'No expiry date'}
          </span>
        </span>
        <StatusPill status={document.status} />
      </label>
    </li>
  )
}

function StatusPill({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${documentStatusClasses[status]}`}
    >
      {(status === 'expired' || status === 'expiring') && <span aria-hidden="true">! </span>}
      {documentStatusLabels[status]}
    </span>
  )
}

export function DeletePackModal({
  pack,
  onConfirm,
  onClose,
}: {
  pack: CompliancePack
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
    <Modal title="Delete compliance pack?" titleId="delete-pack-title" onClose={onClose} dismissable={!deleting}>
      <div className="space-y-4 p-6 text-sm">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}
        <p className="text-slate-600">
          Delete <span className="font-medium text-slate-900">{pack.pack_name}</span>?
          The generated ZIP file will be permanently deleted.
        </p>
        <p className="text-slate-500">
          Your original company and worker documents are not affected. You can
          generate a new pack at any time.
        </p>
      </div>
      <ModalFooter>
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
          {deleting ? 'Deleting…' : 'Delete Pack'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">{children}</div>
  )
}
