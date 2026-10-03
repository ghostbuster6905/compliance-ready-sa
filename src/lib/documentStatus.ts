export type DocumentStatus = 'valid' | 'expiring' | 'expired' | 'missing'

export const EXPIRING_WINDOW_DAYS = 30

export const documentStatusLabels: Record<DocumentStatus, string> = {
  valid: 'Valid',
  expiring: 'Expiring',
  expired: 'Expired',
  missing: 'Missing',
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Converts a YYYY-MM-DD date string to a UTC day number so comparisons are
// not affected by time zones or daylight saving.
function toDayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

/** Today's date in the user's local time zone, as YYYY-MM-DD. */
export function todayISODate(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Whole days from today until the expiry date; negative once expired. */
export function daysUntilExpiry(
  expiryDate: string,
  today: string = todayISODate()
): number {
  return toDayNumber(expiryDate) - toDayNumber(today)
}

/**
 * Derives a document's status from its expiry date (YYYY-MM-DD):
 * - no expiry date → valid
 * - before today → expired
 * - today up to EXPIRING_WINDOW_DAYS days away → expiring
 * - further away → valid
 */
export function calculateDocumentStatus(
  expiryDate: string | null | undefined,
  today: string = todayISODate()
): Exclude<DocumentStatus, 'missing'> {
  if (!expiryDate) return 'valid'

  const daysUntilExpiry = toDayNumber(expiryDate) - toDayNumber(today)

  if (daysUntilExpiry < 0) return 'expired'
  if (daysUntilExpiry <= EXPIRING_WINDOW_DAYS) return 'expiring'
  return 'valid'
}
