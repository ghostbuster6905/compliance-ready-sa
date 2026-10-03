import {
  calculateDocumentStatus,
  daysUntilExpiry,
  todayISODate,
  type DocumentStatus,
} from '@/lib/documentStatus'

/*
 * Project readiness: a transparent MVP calculation over the records configured
 * in ComplianceReady SA. It is NOT a legal compliance assessment.
 *
 *   Checklist component   = completed required items / total required items × 100
 *                           (not configured when there are no required items)
 *   Document components   = average document weight × 100, where
 *                           valid = 1, expiring = 0.5, expired/missing = 0
 *                           (no data when there are no documents)
 *   Overall               = round(average of the components that have data)
 *                           (null when no component has data)
 */

export type HealthDocument = {
  id: string
  document_type: string
  expiry_date: string | null
  status: DocumentStatus | null
}

export type ChecklistLike = {
  id: string
  item_name: string
  required: boolean
  completed: boolean
}

export type ChecklistProgress = {
  completedRequired: number
  totalRequired: number
  optionalCount: number
  completedOptional: number
  /** 0–100, or null when there are no required items. */
  score: number | null
}

export type DocumentHealth = {
  valid: number
  expiring: number
  expired: number
  missing: number
  total: number
  /** 0–100, or null when there are no documents. */
  score: number | null
}

export type ReadinessComponent = {
  key: 'checklist' | 'workerDocuments' | 'companyDocuments'
  label: string
  score: number | null
  emptyLabel: string
}

export type Readiness = {
  components: ReadinessComponent[]
  overall: number | null
  label: ReadinessLabel | null
}

export type ReadinessLabel = 'Strong readiness' | 'Needs attention' | 'Action required'

const documentWeights: Record<DocumentStatus, number> = {
  valid: 1,
  expiring: 0.5,
  expired: 0,
  missing: 0,
}

/** Same rule as the documents pages: derive from expiry, keep stored "missing". */
export function effectiveDocumentStatus(
  document: Pick<HealthDocument, 'expiry_date' | 'status'>,
  today: string = todayISODate()
): DocumentStatus {
  if (document.status === 'missing') return 'missing'
  return calculateDocumentStatus(document.expiry_date, today)
}

export function calculateChecklistProgress(items: ChecklistLike[]): ChecklistProgress {
  const required = items.filter((item) => item.required)
  const optional = items.filter((item) => !item.required)
  const completedRequired = required.filter((item) => item.completed).length

  return {
    completedRequired,
    totalRequired: required.length,
    optionalCount: optional.length,
    completedOptional: optional.filter((item) => item.completed).length,
    score: required.length > 0 ? (completedRequired / required.length) * 100 : null,
  }
}

export function calculateDocumentHealth(
  documents: Pick<HealthDocument, 'expiry_date' | 'status'>[],
  today: string = todayISODate()
): DocumentHealth {
  const health: DocumentHealth = {
    valid: 0,
    expiring: 0,
    expired: 0,
    missing: 0,
    total: documents.length,
    score: null,
  }

  let weightTotal = 0
  for (const document of documents) {
    const status = effectiveDocumentStatus(document, today)
    health[status] += 1
    weightTotal += documentWeights[status]
  }

  if (documents.length > 0) {
    health.score = (weightTotal / documents.length) * 100
  }
  return health
}

export function readinessLabel(score: number): ReadinessLabel {
  if (score >= 90) return 'Strong readiness'
  if (score >= 70) return 'Needs attention'
  return 'Action required'
}

export function calculateReadiness(
  checklist: ChecklistProgress,
  workerDocuments: DocumentHealth,
  companyDocuments: DocumentHealth
): Readiness {
  const components: ReadinessComponent[] = [
    {
      key: 'checklist',
      label: 'Checklist',
      score: checklist.score,
      emptyLabel: 'Not configured',
    },
    {
      key: 'workerDocuments',
      label: 'Worker Documents',
      score: workerDocuments.score,
      emptyLabel: 'No documents recorded',
    },
    {
      key: 'companyDocuments',
      label: 'Company Documents',
      score: companyDocuments.score,
      emptyLabel: 'No documents recorded',
    },
  ]

  const scored = components
    .map((component) => component.score)
    .filter((score): score is number => score !== null)

  if (scored.length === 0) return { components, overall: null, label: null }

  const overall = Math.round(scored.reduce((sum, s) => sum + s, 0) / scored.length)
  return { components, overall, label: readinessLabel(overall) }
}

export type AttentionItem = {
  id: string
  severity: 'expired' | 'missing' | 'expiring' | 'checklist'
  source: 'worker' | 'company' | 'checklist'
  subject: string
  message: string
  /** Sort key within a severity: days until expiry (expired are negative). */
  days: number
  workerId?: string
}

type WorkerDocumentWithOwner = HealthDocument & {
  workerId: string
  workerName: string
}

const severityOrder: Record<AttentionItem['severity'], number> = {
  expired: 0,
  missing: 1,
  expiring: 2,
  checklist: 3,
}

export function describeExpiry(
  expiryDate: string,
  formatDate: (isoDate: string) => string,
  today: string = todayISODate()
) {
  const days = daysUntilExpiry(expiryDate, today)
  if (days < 0) return `expired on ${formatDate(expiryDate)}`
  if (days === 0) return 'expires today'
  if (days === 1) return 'expires tomorrow'
  return `expires in ${days} days`
}

/**
 * Expired, then missing, then expiring documents (most urgent first), then
 * incomplete required checklist items.
 */
export function buildAttentionItems({
  workerDocuments,
  companyDocuments,
  checklistItems,
  formatDate,
  today = todayISODate(),
}: {
  workerDocuments: WorkerDocumentWithOwner[]
  companyDocuments: HealthDocument[]
  checklistItems: ChecklistLike[]
  formatDate: (isoDate: string) => string
  today?: string
}): AttentionItem[] {
  const items: AttentionItem[] = []

  function addDocument(
    document: HealthDocument,
    source: 'worker' | 'company',
    subject: string,
    workerId?: string
  ) {
    const status = effectiveDocumentStatus(document, today)
    if (status === 'valid') return

    const message =
      status === 'missing'
        ? `${document.document_type} is marked as missing`
        : `${document.document_type} ${describeExpiry(document.expiry_date ?? today, formatDate, today)}`

    items.push({
      id: `${source}-${document.id}`,
      severity: status,
      source,
      subject,
      message,
      days: document.expiry_date ? daysUntilExpiry(document.expiry_date, today) : 0,
      workerId,
    })
  }

  for (const document of workerDocuments) {
    addDocument(document, 'worker', document.workerName, document.workerId)
  }
  for (const document of companyDocuments) {
    addDocument(document, 'company', 'Company')
  }
  for (const item of checklistItems) {
    if (item.required && !item.completed) {
      items.push({
        id: `checklist-${item.id}`,
        severity: 'checklist',
        source: 'checklist',
        subject: 'Checklist',
        message: `${item.item_name} is incomplete`,
        days: 0,
      })
    }
  }

  return items.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.days - b.days
  )
}
