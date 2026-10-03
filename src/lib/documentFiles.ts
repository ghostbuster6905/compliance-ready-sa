import { supabase } from '@/lib/supabase'

/** Private Supabase Storage bucket for company compliance documents. */
export const DOCUMENTS_BUCKET = 'company-documents'

/** Private Supabase Storage bucket for worker compliance documents. */
export const WORKER_DOCUMENTS_BUCKET = 'worker-documents'

export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024

/** Value for the file input's accept attribute. A hint only; see validateDocumentFile. */
export const DOCUMENT_FILE_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

const extensionKinds: Record<string, FileKind> = {
  pdf: 'pdf',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
}

const contentTypes: Record<FileKind, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_PATTERN = new RegExp(`^${UUID}$`, 'i')
const FILE_PATH_PATTERN = new RegExp(
  `^(${UUID})/(${UUID})/${UUID}\\.(pdf|jpg|png)$`,
  'i'
)
const WORKER_FILE_PATH_PATTERN = new RegExp(
  `^(${UUID})/(${UUID})/(${UUID})/${UUID}\\.(pdf|jpg|png)$`,
  'i'
)

export type FileKind = 'pdf' | 'jpg' | 'png'

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export type ValidatedFile =
  | { ok: true; kind: FileKind; contentType: string }
  | { ok: false; error: string }

// Identifies the file from its first bytes so a renamed file of another type
// is rejected even when its extension and reported MIME type look valid.
async function detectKind(file: File): Promise<FileKind | null> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const startsWith = (signature: number[]) =>
    signature.every((byte, i) => bytes[i] === byte)

  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith([0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  return null
}

/** Checks a document file's size, extension, MIME type and contents. */
export async function validateDocumentFile(file: File): Promise<ValidatedFile> {
  const unsupported = {
    ok: false as const,
    error: 'Unsupported file type. Please choose a PDF, JPG or PNG file.',
  }

  if (file.size === 0) {
    return { ok: false, error: 'This file is empty. Please choose another file.' }
  }
  if (file.size > MAX_DOCUMENT_FILE_BYTES) {
    return {
      ok: false,
      error: `This file is ${formatFileSize(file.size)}. The maximum size is 10 MB.`,
    }
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const kind = extensionKinds[extension]
  if (!kind) return unsupported

  // Some browsers report an empty type; the content check below still applies.
  if (file.type && file.type !== contentTypes[kind]) return unsupported

  let detected: FileKind | null
  try {
    detected = await detectKind(file)
  } catch {
    return { ok: false, error: "We couldn't read this file. Please try again." }
  }
  if (detected !== kind) return unsupported

  return { ok: true, kind, contentType: contentTypes[kind] }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Builds {company_id}/{document_id}/{random-uuid}.{ext}. The original file
 * name is never part of the path; it is stored in company_documents.file_name.
 */
export function buildDocumentFilePath(
  companyId: string,
  documentId: string,
  kind: FileKind
) {
  if (!UUID_PATTERN.test(companyId) || !UUID_PATTERN.test(documentId)) {
    throw new Error('Invalid document file path.')
  }
  return `${companyId}/${documentId}/${crypto.randomUUID()}.${kind}`
}

/** True only for paths built by buildDocumentFilePath inside this company's folder. */
export function isCompanyDocumentFilePath(
  path: string,
  companyId: string,
  documentId?: string
) {
  const match = FILE_PATH_PATTERN.exec(path)
  if (!match) return false
  if (match[1].toLowerCase() !== companyId.toLowerCase()) return false
  if (documentId && match[2].toLowerCase() !== documentId.toLowerCase()) {
    return false
  }
  return true
}

/**
 * Builds {company_id}/{worker_id}/{document_id}/{random-uuid}.{ext} for the
 * worker-documents bucket. The original file name is never part of the path.
 */
export function buildWorkerDocumentFilePath(
  companyId: string,
  workerId: string,
  documentId: string,
  kind: FileKind
) {
  if (![companyId, workerId, documentId].every((id) => UUID_PATTERN.test(id))) {
    throw new Error('Invalid worker document file path.')
  }
  return `${companyId}/${workerId}/${documentId}/${crypto.randomUUID()}.${kind}`
}

/**
 * True only for paths built by buildWorkerDocumentFilePath inside this
 * company's and worker's folder (and this document's, when given).
 */
export function isWorkerDocumentFilePath(
  path: string,
  companyId: string,
  workerId: string,
  documentId?: string
) {
  const match = WORKER_FILE_PATH_PATTERN.exec(path)
  if (!match) return false
  if (match[1].toLowerCase() !== companyId.toLowerCase()) return false
  if (match[2].toLowerCase() !== workerId.toLowerCase()) return false
  if (documentId && match[3].toLowerCase() !== documentId.toLowerCase()) {
    return false
  }
  return true
}

/**
 * Removes a stored file and confirms it is gone. Storage returns an empty
 * result rather than an error when nothing was deleted (for example when a
 * policy blocks the delete), so an empty result is double-checked.
 */
export async function removeDocumentFile(
  path: string,
  bucketName: string = DOCUMENTS_BUCKET
): Promise<boolean> {
  const bucket = supabase.storage.from(bucketName)

  const { data, error } = await bucket.remove([path])
  if (error) return false
  if (data.length > 0) return true

  try {
    const { data: stillExists } = await bucket.exists(path)
    return !stillExists
  } catch {
    return false
  }
}

/**
 * Creates a short-lived signed URL for a private document file. Pass a file
 * name to have the browser download it instead of displaying it.
 */
export async function createDocumentFileUrl(
  path: string,
  downloadFileName?: string,
  bucketName: string = DOCUMENTS_BUCKET
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(path, 60, {
      download: downloadFileName ?? false,
    })

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
