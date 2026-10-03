import { supabase } from '@/lib/supabase'
import { todayISODate, type DocumentStatus } from '@/lib/documentStatus'
import { describeExpiry, effectiveDocumentStatus } from '@/lib/readiness'
import {
  buildPackFilePath,
  COMPLIANCE_PACKS_BUCKET,
  createDocumentFileUrl,
  DOCUMENTS_BUCKET,
  isCompanyDocumentFilePath,
  isPackFilePath,
  isUuid,
  isWorkerDocumentFilePath,
  removeDocumentFile,
  WORKER_DOCUMENTS_BUCKET,
} from '@/lib/documentFiles'
import { createZip, type ZipEntry } from '@/lib/zip'

/*
 * Compliance packs are generated in the browser, entirely under the signed-in
 * user's own Supabase session, so RLS and Storage policies govern every step:
 *
 *   1. download each selected private file (company-documents / worker-documents)
 *   2. build a ZIP with a README manifest
 *   3. upload it to the private compliance-packs bucket
 *   4. insert the compliance_packs row with status "generated"
 *
 * The row is only inserted once the ZIP is safely stored, so no UPDATE policy
 * is needed and a pack is never recorded as generated when generation failed.
 */

/** Upper bound for the selected files in one pack; the ZIP adds a little overhead, so keep this below the bucket limit (50 MB). */
export const MAX_PACK_BYTES = 45 * 1024 * 1024

export const PACK_DISCLAIMER =
  'This pack contains records selected from ComplianceReady SA. It is intended to assist with document organisation and project readiness. Requirements may vary by client, site, project and applicable law. It does not certify legal compliance.'

export type PackStatus = 'generating' | 'generated' | 'failed'

export type CompliancePack = {
  id: string
  project_id: string
  generated_by: string | null
  pack_name: string
  file_path: string | null
  status: PackStatus
  created_at: string
  project_name: string
}

export type PackDocument = {
  key: string
  source: 'company' | 'worker'
  id: string
  documentType: string
  fileName: string | null
  filePath: string | null
  issueDate: string | null
  expiryDate: string | null
  status: DocumentStatus
  workerId?: string
}

export type PackWorker = {
  id: string
  fullName: string
  trade: string | null
  documents: PackDocument[]
}

export type PackCandidates = {
  companyName: string
  companyDocuments: PackDocument[]
  workers: PackWorker[]
}

export type PackProject = {
  id: string
  project_name: string
  client_name: string | null
  address: string | null
}

const PACK_COLUMNS = 'id, project_id, generated_by, pack_name, file_path, status, created_at'

const DOCUMENT_COLUMNS = 'id, document_type, file_name, file_path, issue_date, expiry_date, status'

type RawDocument = {
  id: string
  document_type: string
  file_name: string | null
  file_path: string | null
  issue_date: string | null
  expiry_date: string | null
  status: DocumentStatus | null
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatIsoDate(isoDate: string) {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}

function toPackDocument(
  raw: RawDocument,
  source: 'company' | 'worker',
  today: string,
  workerId?: string
): PackDocument {
  return {
    key: `${source}:${raw.id}`,
    source,
    id: raw.id,
    documentType: raw.document_type,
    fileName: raw.file_name,
    filePath: raw.file_path,
    issueDate: raw.issue_date,
    expiryDate: raw.expiry_date,
    status: effectiveDocumentStatus(raw, today),
    workerId,
  }
}

/** Only files that exist and are valid or expiring are selected by default. */
export function isDefaultSelected(document: PackDocument) {
  return (
    Boolean(document.filePath) &&
    (document.status === 'valid' || document.status === 'expiring')
  )
}

// Callers must only use this after the project has been loaded through the
// company-scoped project query.
export async function loadPackCandidates(
  companyId: string,
  projectId: string
): Promise<PackCandidates | null> {
  const today = todayISODate()

  const [companyResult, documentsResult, workersResult] = await Promise.all([
    supabase.from('companies').select('name').eq('id', companyId).maybeSingle<{ name: string }>(),
    supabase
      .from('company_documents')
      .select(DOCUMENT_COLUMNS)
      .eq('company_id', companyId)
      .overrideTypes<RawDocument[], { merge: false }>(),
    // Only workers assigned to this project, through project_workers.
    supabase
      .from('project_workers')
      .select(
        `workers(id, company_id, full_name, trade, worker_documents(${DOCUMENT_COLUMNS}))`
      )
      .eq('project_id', projectId)
      .overrideTypes<
        {
          workers: {
            id: string
            company_id: string
            full_name: string
            trade: string | null
            worker_documents: RawDocument[] | null
          } | null
        }[],
        { merge: false }
      >(),
  ])

  if (companyResult.error || documentsResult.error || workersResult.error) return null

  const byType = (a: PackDocument, b: PackDocument) =>
    a.documentType.localeCompare(b.documentType)

  const workers: PackWorker[] = (workersResult.data ?? [])
    .flatMap(({ workers: worker }) =>
      // Defence in depth: RLS should never return another company's worker.
      worker && worker.company_id === companyId ? [worker] : []
    )
    .map((worker) => ({
      id: worker.id,
      fullName: worker.full_name,
      trade: worker.trade,
      documents: (worker.worker_documents ?? [])
        .map((raw) => toPackDocument(raw, 'worker', today, worker.id))
        .sort(byType),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))

  return {
    companyName: companyResult.data?.name ?? 'Your company',
    companyDocuments: (documentsResult.data ?? [])
      .map((raw) => toPackDocument(raw, 'company', today))
      .sort(byType),
    workers,
  }
}

// ---------------------------------------------------------------------------
// File naming inside the archive
// ---------------------------------------------------------------------------

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Makes a single path segment safe for ZIP extraction on Windows/macOS/Linux. */
export function sanitizeSegment(name: string, maxLength = 100): string {
  let cleaned = name
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')

  if (cleaned.length > maxLength) cleaned = cleaned.slice(0, maxLength).trim()
  if (WINDOWS_RESERVED.test(cleaned.split('.')[0])) cleaned = `_${cleaned}`
  return cleaned
}

function extensionOf(path: string) {
  const match = /\.([a-z0-9]+)$/i.exec(path)
  return match ? match[1].toLowerCase() : ''
}

/** "{Document Type} - {original file name}", keeping the stored file's extension. */
export function archiveFileName(document: PackDocument): string {
  const ext = extensionOf(document.filePath ?? '') || 'pdf'
  const original = (document.fileName ?? '').replace(/\.[a-z0-9]+$/i, '')
  const base = original
    ? `${document.documentType} - ${original}`
    : document.documentType
  const safe = sanitizeSegment(base, 120) || 'Document'
  return `${safe}.${ext}`
}

/** Appends " (2)", " (3)"… before the extension until the name is unused. */
export function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''

  let candidate = name
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = `${stem} (${n})${ext}`
  }
  used.add(candidate.toLowerCase())
  return candidate
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const statusLabels: Record<DocumentStatus, string> = {
  valid: 'Valid',
  expiring: 'Expiring',
  expired: 'Expired',
  missing: 'Missing',
}

export type ManifestEntry = { document: PackDocument; archivePath: string }

export function buildManifest({
  packName,
  companyName,
  project,
  generatedBy,
  generatedAt,
  companyEntries,
  workerEntries,
  today = todayISODate(generatedAt),
}: {
  packName: string
  companyName: string
  project: PackProject
  generatedBy: string
  generatedAt: Date
  companyEntries: ManifestEntry[]
  workerEntries: { worker: PackWorker; entries: ManifestEntry[] }[]
  today?: string
}): string {
  const lines: string[] = []
  const generated = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(generatedAt)

  const all = [...companyEntries, ...workerEntries.flatMap((w) => w.entries)]
  const count = (status: DocumentStatus) =>
    all.filter((e) => e.document.status === status).length

  function describe(entry: ManifestEntry, indent: string, index: number) {
    const d = entry.document
    const status = statusLabels[d.status]
    const detail =
      d.expiryDate && (d.status === 'expired' || d.status === 'expiring')
        ? ` (${describeExpiry(d.expiryDate, formatIsoDate, today)})`
        : ''
    lines.push(`${indent}${index}. ${d.documentType}`)
    lines.push(`${indent}   File in pack:       ${entry.archivePath}`)
    if (d.fileName) lines.push(`${indent}   Original file name: ${d.fileName}`)
    lines.push(`${indent}   Issue date:         ${d.issueDate ? formatIsoDate(d.issueDate) : 'Not recorded'}`)
    lines.push(`${indent}   Expiry date:        ${d.expiryDate ? formatIsoDate(d.expiryDate) : 'No expiry date'}`)
    lines.push(`${indent}   Status:             ${status}${detail}`)
    lines.push('')
  }

  lines.push('COMPLIANCE PACK', '===============', '')
  lines.push(`Pack name:       ${packName}`)
  lines.push(`Company:         ${companyName}`)
  lines.push(`Project:         ${project.project_name}`)
  if (project.client_name) lines.push(`Client:          ${project.client_name}`)
  if (project.address) lines.push(`Project address: ${project.address.replace(/\s*\n\s*/g, ', ')}`)
  lines.push(`Generated:       ${generated}`)
  lines.push(`Generated by:    ${generatedBy}`)
  lines.push('')
  lines.push('IMPORTANT', '---------', PACK_DISCLAIMER)
  lines.push(
    'Document statuses were calculated from each expiry date on the generation date shown above and may have changed since.',
    ''
  )

  lines.push('SUMMARY', '-------')
  lines.push(`Company documents: ${companyEntries.length}`)
  lines.push(`Workers included:  ${workerEntries.length}`)
  lines.push(`Worker documents:  ${all.length - companyEntries.length}`)
  lines.push(
    `Status at generation: ${count('valid')} valid, ${count('expiring')} expiring, ${count('expired')} expired` +
      (count('missing') ? `, ${count('missing')} missing` : '')
  )
  lines.push('')

  lines.push('COMPANY DOCUMENTS', '-----------------')
  if (companyEntries.length === 0) lines.push('None selected.', '')
  companyEntries.forEach((entry, i) => describe(entry, '', i + 1))

  lines.push('WORKERS AND WORKER DOCUMENTS', '----------------------------')
  if (workerEntries.length === 0) lines.push('None selected.', '')
  for (const { worker, entries } of workerEntries) {
    lines.push(`${worker.fullName}${worker.trade ? ` (${worker.trade})` : ''}`)
    entries.forEach((entry, i) => describe(entry, '  ', i + 1))
  }

  return lines.join('\r\n')
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type GenerateProgress =
  | { stage: 'downloading'; done: number; total: number }
  | { stage: 'zipping' }
  | { stage: 'uploading' }
  | { stage: 'saving' }
  | { stage: 'cleaning' }

type GenerateResult = { ok: true; pack: CompliancePack } | { ok: false; error: string }

function sourceLabel(document: PackDocument, workers: Map<string, PackWorker>) {
  return document.workerId
    ? `${workers.get(document.workerId)?.fullName ?? 'Worker'} — ${document.documentType}`
    : document.documentType
}

export async function generateCompliancePack({
  companyId,
  userId,
  generatedByName,
  project,
  packName,
  candidates,
  selectedKeys,
  onProgress,
}: {
  companyId: string
  userId: string
  generatedByName: string
  project: PackProject
  packName: string
  candidates: PackCandidates
  selectedKeys: Set<string>
  onProgress: (progress: GenerateProgress) => void
}): Promise<GenerateResult> {
  const name = packName.trim()
  if (!name) return { ok: false, error: 'Pack name is required.' }
  if (name.length > 150) return { ok: false, error: 'Pack name must be 150 characters or fewer.' }
  if (![companyId, userId, project.id].every(isUuid)) {
    return { ok: false, error: 'Your session is not ready yet. Please refresh and try again.' }
  }

  const workersById = new Map(candidates.workers.map((w) => [w.id, w]))
  const companySelected = candidates.companyDocuments.filter(
    (d) => selectedKeys.has(d.key) && d.filePath
  )
  const workerSelected = candidates.workers.map((worker) => ({
    worker,
    documents: worker.documents.filter((d) => selectedKeys.has(d.key) && d.filePath),
  }))
  const allSelected = [...companySelected, ...workerSelected.flatMap((w) => w.documents)]

  if (allSelected.length === 0) {
    return { ok: false, error: 'Select at least one document with an uploaded file.' }
  }

  // Every source path must be one the app itself created inside this
  // company's folders; Storage policies enforce the same on the server.
  for (const d of allSelected) {
    const valid =
      d.source === 'company'
        ? isCompanyDocumentFilePath(d.filePath!, companyId, d.id)
        : isWorkerDocumentFilePath(d.filePath!, companyId, d.workerId!, d.id)
    if (!valid) {
      return {
        ok: false,
        error: `“${sourceLabel(d, workersById)}” has an invalid file location and can't be included. Deselect it and try again.`,
      }
    }
  }

  // 1. Download the selected private files with the user's own session.
  const files = new Map<string, Uint8Array>()
  let totalBytes = 0
  for (const [index, d] of allSelected.entries()) {
    onProgress({ stage: 'downloading', done: index, total: allSelected.length })
    const bucket = d.source === 'company' ? DOCUMENTS_BUCKET : WORKER_DOCUMENTS_BUCKET
    const { data, error } = await supabase.storage.from(bucket).download(d.filePath!)

    if (error || !data) {
      return {
        ok: false,
        error: `We couldn't retrieve the file for “${sourceLabel(d, workersById)}”. It may have been removed or you may no longer have access. Deselect it and try again.`,
      }
    }

    totalBytes += data.size
    if (totalBytes > MAX_PACK_BYTES) {
      return {
        ok: false,
        error: `The selected files are larger than the ${MAX_PACK_BYTES / (1024 * 1024)} MB pack limit. Select fewer documents and try again.`,
      }
    }
    files.set(d.key, new Uint8Array(await data.arrayBuffer()))
  }

  // 2. Build the archive and manifest.
  onProgress({ stage: 'zipping' })
  const generatedAt = new Date()
  const entries: ZipEntry[] = []

  const companyFolder = 'Company Documents'
  const usedCompanyNames = new Set<string>()
  const companyEntries: ManifestEntry[] = companySelected.map((document) => {
    const archivePath = `${companyFolder}/${uniqueName(archiveFileName(document), usedCompanyNames)}`
    entries.push({ name: archivePath, data: files.get(document.key)! })
    return { document, archivePath }
  })

  const usedWorkerFolders = new Set<string>()
  const workerEntries = workerSelected
    .filter((w) => w.documents.length > 0)
    .map(({ worker, documents }) => {
      const folder = uniqueName(sanitizeSegment(worker.fullName) || 'Worker', usedWorkerFolders)
      const usedNames = new Set<string>()
      const manifestEntries = documents.map((document) => {
        const archivePath = `Workers/${folder}/${uniqueName(archiveFileName(document), usedNames)}`
        entries.push({ name: archivePath, data: files.get(document.key)! })
        return { document, archivePath }
      })
      return { worker, entries: manifestEntries }
    })

  const manifest = buildManifest({
    packName: name,
    companyName: candidates.companyName,
    project,
    generatedBy: generatedByName,
    generatedAt,
    companyEntries,
    workerEntries,
  })
  entries.unshift({ name: 'README.txt', data: new TextEncoder().encode(manifest) })

  let zip: Blob
  try {
    zip = createZip(entries, generatedAt)
  } catch {
    return { ok: false, error: "We couldn't build the pack archive. Try selecting fewer documents." }
  }

  // 3. Upload the ZIP to the private bucket under a new pack ID.
  const packId = crypto.randomUUID()
  const path = buildPackFilePath(companyId, project.id, packId)

  onProgress({ stage: 'uploading' })
  const { error: uploadError } = await supabase.storage
    .from(COMPLIANCE_PACKS_BUCKET)
    .upload(path, zip, { contentType: 'application/zip', upsert: false })

  if (uploadError) {
    return { ok: false, error: "We couldn't save the generated pack. Nothing was recorded. Please try again." }
  }

  // 4. Record the pack only once the ZIP is safely stored.
  onProgress({ stage: 'saving' })
  const { data: row, error: insertError } = await supabase
    .from('compliance_packs')
    .insert({
      id: packId,
      project_id: project.id,
      generated_by: userId,
      pack_name: name,
      file_path: path,
      status: 'generated',
    })
    .select(PACK_COLUMNS)
    .single<Omit<CompliancePack, 'project_name'>>()

  if (insertError || !row) {
    onProgress({ stage: 'cleaning' })
    const cleaned = await removeDocumentFile(path, COMPLIANCE_PACKS_BUCKET)
    return {
      ok: false,
      error: cleaned
        ? "We couldn't record the pack, so it was discarded. Please try again."
        : "We couldn't record the pack, and the uploaded archive couldn't be cleaned up. Please try again; the leftover file is private to your company.",
    }
  }

  return { ok: true, pack: { ...row, project_name: project.project_name } }
}

// ---------------------------------------------------------------------------
// Listing, download and delete
// ---------------------------------------------------------------------------

type PackRow = Omit<CompliancePack, 'project_name'> & {
  projects: { project_name: string; company_id: string } | null
}

export async function loadPacks(companyId: string): Promise<CompliancePack[] | null> {
  // Inner join so only packs whose project belongs to this company are
  // returned; RLS on compliance_packs is the actual boundary.
  const { data, error } = await supabase
    .from('compliance_packs')
    .select(`${PACK_COLUMNS}, projects!inner(project_name, company_id)`)
    .eq('projects.company_id', companyId)
    .order('created_at', { ascending: false })
    .overrideTypes<PackRow[], { merge: false }>()

  if (error) return null

  return (data ?? [])
    .filter((row) => row.projects?.company_id === companyId)
    .map(({ projects, ...pack }) => ({
      ...pack,
      project_name: projects?.project_name ?? 'Unknown project',
    }))
}

/**
 * Names for generated_by user IDs. Profiles RLS may only expose the user's own
 * row, so missing names fall back to a neutral label in the UI.
 */
export async function loadCreatorNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].filter(isUuid)
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', ids)
  if (error || !data) return new Map()
  return new Map(data.map((p) => [p.id as string, p.full_name as string]))
}

export async function createPackDownloadUrl(
  companyId: string,
  pack: CompliancePack
): Promise<string | null> {
  if (
    pack.status !== 'generated' ||
    !pack.file_path ||
    !isPackFilePath(pack.file_path, companyId, pack.project_id, pack.id)
  ) {
    return null
  }
  const downloadName = `${sanitizeSegment(pack.pack_name, 120) || 'Compliance Pack'}.zip`
  return createDocumentFileUrl(pack.file_path, downloadName, COMPLIANCE_PACKS_BUCKET)
}

/**
 * Removes the generated ZIP first, then the record. Never touches the source
 * company or worker documents.
 */
export async function deletePack(
  companyId: string,
  pack: CompliancePack
): Promise<string | null> {
  if (pack.file_path) {
    if (!isPackFilePath(pack.file_path, companyId, pack.project_id, pack.id)) {
      return "This pack's file location is invalid, so it can't be removed safely. Please contact support."
    }
    const removed = await removeDocumentFile(pack.file_path, COMPLIANCE_PACKS_BUCKET)
    if (!removed) {
      return "We couldn't delete the pack's ZIP file, so the pack was kept. Please try again."
    }
  }

  const { data, error } = await supabase
    .from('compliance_packs')
    .delete()
    .eq('id', pack.id)
    .eq('project_id', pack.project_id)
    .select('id')

  if (error || !data || data.length === 0) {
    return pack.file_path
      ? "The pack's ZIP file was deleted, but the pack record couldn't be removed. Please try again."
      : "We couldn't delete this pack. Please try again."
  }
  return null
}
