import { supabase } from '@/lib/supabase'
import { isUuid } from '@/lib/documentFiles'
import type { DocumentAlert } from '@/lib/companyOverview'

export type NotificationType =
  | 'general'
  | 'document_expiry'
  | 'document_expired'
  | 'project'
  | 'compliance'

export type StoredNotification = {
  id: string
  company_id: string
  user_id: string | null
  title: string
  message: string
  notification_type: NotificationType
  is_read: boolean
  created_at: string
}

const NOTIFICATION_COLUMNS =
  'id, company_id, user_id, title, message, notification_type, is_read, created_at'

/**
 * Stored notifications for the company that are either company-wide
 * (user_id is null) or addressed to this user. RLS limits rows to the
 * company; there is no INSERT/DELETE from the browser.
 */
export async function loadStoredNotifications(
  companyId: string,
  userId: string
): Promise<StoredNotification[] | null> {
  if (!isUuid(userId)) return null

  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('company_id', companyId)
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .overrideTypes<StoredNotification[], { merge: false }>()

  return error ? null : (data ?? [])
}

/** Uses the existing UPDATE policy; only is_read is changed. */
export async function setNotificationRead(
  companyId: string,
  ids: string[],
  isRead: boolean
): Promise<{ updatedIds: string[]; error: string | null }> {
  if (ids.length === 0) return { updatedIds: [], error: null }

  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: isRead })
    .in('id', ids)
    .eq('company_id', companyId)
    .select('id')

  if (error) {
    return { updatedIds: [], error: "We couldn't update this notification. Please try again." }
  }
  const updatedIds = (data ?? []).map((row) => row.id as string)
  if (updatedIds.length < ids.length) {
    return {
      updatedIds,
      error: 'Some notifications could not be updated. Please refresh and try again.',
    }
  }
  return { updatedIds, error: null }
}

const normalise = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Stored notifications have no document reference, so the only reliable
 * duplicate is an expiry notification whose message matches a live alert's.
 */
export function isDuplicateOfAlert(
  notification: StoredNotification,
  alertMessages: Set<string>
) {
  return (
    (notification.notification_type === 'document_expiry' ||
      notification.notification_type === 'document_expired') &&
    alertMessages.has(normalise(notification.message))
  )
}

/** Bell count: live expired/expiring alerts + unread stored notifications (minus obvious duplicates). */
export function actionNeededCount(
  alerts: DocumentAlert[],
  notifications: StoredNotification[]
) {
  const alertMessages = new Set(alerts.map((a) => normalise(a.message)))
  const unread = notifications.filter(
    (n) => !n.is_read && !isDuplicateOfAlert(n, alertMessages)
  ).length
  return alerts.length + unread
}

export function alertMessageSet(alerts: DocumentAlert[]) {
  return new Set(alerts.map((a) => normalise(a.message)))
}
