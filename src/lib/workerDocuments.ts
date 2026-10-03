import { supabase } from '@/lib/supabase'
import { calculateDocumentStatus, type DocumentStatus } from '@/lib/documentStatus'
import {
  buildWorkerDocumentFilePath,
  createDocumentFileUrl,
  isWorkerDocumentFilePath,
  removeDocumentFile,
  validateDocumentFile,
  WORKER_DOCUMENTS_BUCKET,
  isUuid,
} from '@/lib/documentFiles'

export type WorkerDocument = {
  id: string
  worker_id: string
  document_type: string
  file_name: string | null
  file_path: string | null
  issue_date: string | null
  expiry_date: string | null
  status: DocumentStatus
  created_at: string
  updated_at: string | null
}

export type WorkerDocumentFormValues = {
  documentType: string
  issueDate: string
  expiryDate: string
  file: File | null
}

export type WorkerDocumentSaveStage = 'uploading' | 'saving' | 'cleaning'

export const WORKER_DOCUMENT_COLUMNS =
  'id, worker_id, document_type, file_name, file_path, issue_date, expiry_date, status, created_at, updated_at'

/** Organisational categories only; requirements differ per project and client. */
export const WORKER_DOCUMENT_TYPES = [
  'Medical Certificate of Fitness',
  'Health & Safety Training',
  'Working at Heights',
  'First Aid',
  'Fire Fighting',
  'Trade Certificate',
  'Competency Certificate',
  'Operator Certificate',
  'Induction',
  'Identity Document',
] as const

export const OTHER_DOCUMENT_TYPE = 'Other'

// The stored status is only recalculated on save, so derive it from the
// expiry date for display. "missing" is never derived, so keep it as stored.
export function getWorkerDocumentDisplayStatus(
  document: WorkerDocument
): DocumentStatus {
  if (document.status === 'missing') return 'missing'
  return calculateDocumentStatus(document.expiry_date)
}

// Soonest expiry first; documents without an expiry date last.
export function sortWorkerDocuments(documents: WorkerDocument[]) {
  return [...documents].sort((a, b) => {
    if (a.expiry_date === b.expiry_date) {
      return a.document_type.localeCompare(b.document_type)
    }
    if (!a.expiry_date) return 1
    if (!b.expiry_date) return -1
    return a.expiry_date.localeCompare(b.expiry_date)
  })
}

type Scope = { companyId: string; workerId: string }

function assertScope({ companyId, workerId }: Scope) {
  if (!isUuid(companyId) || !isUuid(workerId)) {
    throw new Error('Invalid company or worker.')
  }
}

export async function loadWorkerDocuments(
  workerId: string
): Promise<WorkerDocument[] | null> {
  if (!isUuid(workerId)) return null

  const { data, error } = await supabase
    .from('worker_documents')
    .select(WORKER_DOCUMENT_COLUMNS)
    .eq('worker_id', workerId)
    .overrideTypes<WorkerDocument[], { merge: false }>()

  if (error) return null
  return sortWorkerDocuments(data ?? [])
}

type SaveResult =
  | { ok: true; document: WorkerDocument; warning: string | null }
  | { ok: false; error: string }

/**
 * Creates or updates a worker document, uploading a file first when one is
 * given. Order: validate → upload → save row → remove replaced file. If the
 * row can't be saved, the new upload is removed and the old reference kept.
 */
export async function saveWorkerDocument({
  scope,
  existing,
  values,
  onStage,
}: {
  scope: Scope
  existing: WorkerDocument | null
  values: WorkerDocumentFormValues
  onStage: (stage: WorkerDocumentSaveStage) => void
}): Promise<SaveResult> {
  assertScope(scope)
  const { companyId, workerId } = scope

  const documentId = existing ? existing.id : crypto.randomUUID()
  const expiryDate = values.expiryDate || null

  let uploaded: { path: string; name: string } | null = null

  if (values.file) {
    const check = await validateDocumentFile(values.file)
    if (!check.ok) return { ok: false, error: check.error }

    const path = buildWorkerDocumentFilePath(
      companyId,
      workerId,
      documentId,
      check.kind
    )
    onStage('uploading')
    const { error: uploadError } = await supabase.storage
      .from(WORKER_DOCUMENTS_BUCKET)
      .upload(path, values.file, { contentType: check.contentType, upsert: false })

    if (uploadError) {
      return {
        ok: false,
        error: "We couldn't upload your file, so nothing was saved. Please try again.",
      }
    }
    uploaded = { path, name: values.file.name.slice(0, 255) }
  }

  const fields = {
    document_type: values.documentType.trim(),
    issue_date: values.issueDate || null,
    expiry_date: expiryDate,
    status: calculateDocumentStatus(expiryDate),
    ...(uploaded && { file_name: uploaded.name, file_path: uploaded.path }),
  }

  onStage('saving')
  let saved: WorkerDocument | null = null
  let saveError: string

  if (existing) {
    const { data, error } = await supabase
      .from('worker_documents')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('worker_id', workerId)
      .select(WORKER_DOCUMENT_COLUMNS)
      .maybeSingle<WorkerDocument>()

    saved = data
    saveError = error
      ? "We couldn't save your changes. Please try again."
      : "This document couldn't be found. It may have been deleted."
  } else {
    const { data, error } = await supabase
      .from('worker_documents')
      .insert({ ...fields, id: documentId, worker_id: workerId })
      .select(WORKER_DOCUMENT_COLUMNS)
      .single<WorkerDocument>()

    saved = error ? null : data
    saveError = "We couldn't add this document. Please try again."
  }

  if (!saved) {
    if (uploaded) {
      onStage('cleaning')
      await removeDocumentFile(uploaded.path, WORKER_DOCUMENTS_BUCKET)
    }
    return { ok: false, error: saveError }
  }

  let warning: string | null = null
  const previousPath = existing?.file_path ?? null

  if (uploaded && previousPath && previousPath !== uploaded.path) {
    onStage('cleaning')
    const removed =
      isWorkerDocumentFilePath(previousPath, companyId, workerId, documentId) &&
      (await removeDocumentFile(previousPath, WORKER_DOCUMENTS_BUCKET))
    if (!removed) {
      warning = `${saved.document_type} was updated with the new file, but the previous file couldn't be removed from storage.`
    }
  }

  return { ok: true, document: saved, warning }
}

/**
 * Removes the stored file first, then the row. If the file can't be removed
 * the row is kept so the user is never told it is gone while the file remains.
 */
export async function deleteWorkerDocument(
  scope: Scope,
  document: WorkerDocument
): Promise<string | null> {
  assertScope(scope)
  const { companyId, workerId } = scope

  if (document.file_path) {
    if (
      !isWorkerDocumentFilePath(document.file_path, companyId, workerId, document.id)
    ) {
      return "This document's file location is invalid, so it can't be removed safely. Please contact support."
    }

    const removed = await removeDocumentFile(
      document.file_path,
      WORKER_DOCUMENTS_BUCKET
    )
    if (!removed) {
      return "We couldn't delete the attached file, so the document was kept. Please try again."
    }
  }

  const { data, error } = await supabase
    .from('worker_documents')
    .delete()
    .eq('id', document.id)
    .eq('worker_id', workerId)
    .select('id')

  if (error || !data || data.length === 0) {
    return document.file_path
      ? "The attached file was deleted, but the document record couldn't be removed. Please try again."
      : "We couldn't delete this document. Please try again."
  }
  return null
}

/** Short-lived signed URL for a worker document file, after path validation. */
export async function createWorkerDocumentFileUrl(
  scope: Scope,
  document: WorkerDocument,
  downloadFileName?: string
): Promise<string | null> {
  if (
    !document.file_path ||
    !isWorkerDocumentFilePath(
      document.file_path,
      scope.companyId,
      scope.workerId,
      document.id
    )
  ) {
    return null
  }
  return createDocumentFileUrl(
    document.file_path,
    downloadFileName,
    WORKER_DOCUMENTS_BUCKET
  )
}

/**
 * Removes every stored file for a worker's documents. Called before a worker
 * is deleted, because deleting the worker cascades to worker_documents rows
 * but cannot remove Storage objects. Returns false if any file remains.
 */
export async function removeAllWorkerDocumentFiles(scope: Scope): Promise<boolean> {
  assertScope(scope)

  const { data, error } = await supabase
    .from('worker_documents')
    .select('id, file_path')
    .eq('worker_id', scope.workerId)
    .not('file_path', 'is', null)
    .overrideTypes<{ id: string; file_path: string }[], { merge: false }>()

  if (error) return false

  for (const document of data ?? []) {
    if (
      !isWorkerDocumentFilePath(
        document.file_path,
        scope.companyId,
        scope.workerId,
        document.id
      )
    ) {
      return false
    }
    const removed = await removeDocumentFile(document.file_path, WORKER_DOCUMENTS_BUCKET)
    if (!removed) return false
  }

  return true
}
