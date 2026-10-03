import { supabase } from '@/lib/supabase'
import { todayISODate, daysUntilExpiry, type DocumentStatus } from '@/lib/documentStatus'
import {
  calculateChecklistProgress,
  calculateDocumentHealth,
  calculateReadiness,
  effectiveDocumentStatus,
  readinessLabel,
  describeExpiry,
  type DocumentHealth,
  type HealthDocument,
  type ReadinessLabel,
} from '@/lib/readiness'
import type { WorkerStatus } from '@/lib/workers'

/*
 * Company-wide overview data for the dashboard and notifications.
 *
 * Loaded with a few company-scoped queries (no per-worker or per-project
 * round trips). RLS on every table is the security boundary; the explicit
 * company_id filters keep queries scoped even if a policy were broader.
 */

export type OverviewWorker = {
  id: string
  full_name: string
  status: WorkerStatus
  worker_documents: HealthDocument[]
}

export type OverviewProject = {
  id: string
  project_name: string
  client_name: string | null
  status: string
  project_checklists: { id: string; item_name: string; required: boolean; completed: boolean }[]
  project_workers: { worker_id: string }[]
}

export type DocumentAlert = {
  id: string
  source: 'company' | 'worker'
  status: Extract<DocumentStatus, 'expired' | 'expiring'>
  documentType: string
  expiryDate: string
  days: number
  subjectName: string
  workerId?: string
  message: string
}

export type ProjectReadinessSummary = {
  id: string
  name: string
  client: string | null
  overall: number | null
  label: ReadinessLabel | null
}

const HEALTH_COLUMNS = 'id, document_type, expiry_date, status'

export async function loadCompanyDocuments(companyId: string) {
  const { data, error } = await supabase
    .from('company_documents')
    .select(HEALTH_COLUMNS)
    .eq('company_id', companyId)
    .overrideTypes<HealthDocument[], { merge: false }>()
  return error ? null : (data ?? [])
}

/** All of the company's workers with their documents, in one query. */
export async function loadWorkersWithDocuments(companyId: string) {
  const { data, error } = await supabase
    .from('workers')
    .select(`id, full_name, status, worker_documents(${HEALTH_COLUMNS})`)
    .eq('company_id', companyId)
    .overrideTypes<OverviewWorker[], { merge: false }>()
  if (error) return null
  return (data ?? []).map((w) => ({ ...w, worker_documents: w.worker_documents ?? [] }))
}

/** The company's projects with checklist items and assignments, in one query. */
export async function loadProjectsForReadiness(companyId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, project_name, client_name, status, project_checklists(id, item_name, required, completed), project_workers(worker_id)'
    )
    .eq('company_id', companyId)
    .overrideTypes<OverviewProject[], { merge: false }>()
  if (error) return null
  return (data ?? []).map((p) => ({
    ...p,
    project_checklists: p.project_checklists ?? [],
    project_workers: p.project_workers ?? [],
  }))
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function companyDocumentStats(documents: HealthDocument[], today = todayISODate()) {
  return calculateDocumentHealth(documents, today)
}

/**
 * Worker counts. Attention counts are per WORKER (not per document), using
 * each active worker's worst current document status: a worker with any
 * expired document counts once as "expired"; otherwise once as "expiring" if
 * any document expires within 30 days.
 */
export function workerStats(workers: OverviewWorker[], today = todayISODate()) {
  let active = 0
  let inactive = 0
  let withExpired = 0
  let withExpiring = 0

  for (const worker of workers) {
    if (worker.status !== 'active') {
      inactive += 1
      continue
    }
    active += 1
    const statuses = worker.worker_documents.map((d) => effectiveDocumentStatus(d, today))
    if (statuses.includes('expired')) withExpired += 1
    else if (statuses.includes('expiring')) withExpiring += 1
  }

  return { active, inactive, withExpired, withExpiring }
}

// ---------------------------------------------------------------------------
// Project readiness (same formula as /projects/[id])
// ---------------------------------------------------------------------------

/**
 * Mirrors the project profile: checklist progress, health of documents of
 * workers assigned via project_workers, and company document health, combined
 * with calculateReadiness.
 */
export function projectReadiness(
  project: OverviewProject,
  workersById: Map<string, OverviewWorker>,
  companyHealth: DocumentHealth,
  today = todayISODate()
): ProjectReadinessSummary {
  const assignedDocuments = project.project_workers.flatMap(
    ({ worker_id }) => workersById.get(worker_id)?.worker_documents ?? []
  )
  const readiness = calculateReadiness(
    calculateChecklistProgress(project.project_checklists),
    calculateDocumentHealth(assignedDocuments, today),
    companyHealth
  )
  return {
    id: project.id,
    name: project.project_name,
    client: project.client_name,
    overall: readiness.overall,
    label: readiness.label,
  }
}

/**
 * Overall Readiness = round(average of the readiness % of active projects
 * that have one). Projects without configured data are excluded; if none
 * remain, the result is null ("Not configured"), never 100%.
 */
export function overallReadiness(projects: ProjectReadinessSummary[]) {
  const scored = projects
    .map((p) => p.overall)
    .filter((score): score is number => score !== null)

  if (scored.length === 0) {
    return { score: null, label: null, scoredCount: 0, totalCount: projects.length }
  }
  const score = Math.round(scored.reduce((sum, s) => sum + s, 0) / scored.length)
  return {
    score,
    label: readinessLabel(score),
    scoredCount: scored.length,
    totalCount: projects.length,
  }
}

// ---------------------------------------------------------------------------
// Document alerts (derived live from expiry dates; never stored)
// ---------------------------------------------------------------------------

const alertDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatAlertDate(isoDate: string) {
  return alertDateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}

/**
 * Expired and expiring documents for the company and its ACTIVE workers.
 * Expired first (most overdue first), then expiring (soonest first).
 */
export function buildDocumentAlerts(
  companyDocuments: HealthDocument[],
  workers: OverviewWorker[],
  today = todayISODate()
): DocumentAlert[] {
  const alerts: DocumentAlert[] = []

  function add(
    document: HealthDocument,
    source: 'company' | 'worker',
    subjectName: string,
    workerId?: string
  ) {
    const status = effectiveDocumentStatus(document, today)
    if ((status !== 'expired' && status !== 'expiring') || !document.expiry_date) return

    const when = describeExpiry(document.expiry_date, formatAlertDate, today)
    const message =
      source === 'worker'
        ? `${document.document_type} for ${subjectName} ${when}.`
        : `${document.document_type} ${when}.`

    alerts.push({
      id: `${source}:${document.id}`,
      source,
      status,
      documentType: document.document_type,
      expiryDate: document.expiry_date,
      days: daysUntilExpiry(document.expiry_date, today),
      subjectName,
      workerId,
      message: message.charAt(0).toUpperCase() + message.slice(1),
    })
  }

  for (const document of companyDocuments) add(document, 'company', 'Company')
  for (const worker of workers) {
    if (worker.status !== 'active') continue
    for (const document of worker.worker_documents) {
      add(document, 'worker', worker.full_name, worker.id)
    }
  }

  return alerts.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'expired' ? -1 : 1
    return a.days - b.days
  })
}
