'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireProfile } from '@/lib/useRequireProfile'
import {
  buildDocumentAlerts,
  formatAlertDate,
  loadCompanyDocuments,
  loadWorkersWithDocuments,
  type DocumentAlert,
} from '@/lib/companyOverview'
import {
  alertMessageSet,
  isDuplicateOfAlert,
  loadStoredNotifications,
  setNotificationRead,
  type NotificationType,
  type StoredNotification,
} from '@/lib/notifications'
import {
  AppHeader,
  AuthErrorCard,
  CenteredScreen,
  FeedbackBanner,
  Spinner,
  useFeedback,
} from '@/app/workers/WorkerComponents'

type Filter = 'all' | 'expired' | 'expiring' | 'unread'

const filterLabels: Record<Filter, string> = {
  all: 'All',
  expired: 'Expired',
  expiring: 'Expiring',
  unread: 'Unread',
}

const typeLabels: Record<NotificationType, string> = {
  general: 'General',
  document_expiry: 'Expiring',
  document_expired: 'Expired',
  project: 'Project',
  compliance: 'Readiness',
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function alertMatches(alert: DocumentAlert, filter: Filter) {
  if (filter === 'all') return true
  if (filter === 'unread') return false // live alerts have no read state
  return alert.status === filter
}

function notificationMatches(notification: StoredNotification, filter: Filter) {
  switch (filter) {
    case 'all':
      return true
    case 'unread':
      return !notification.is_read
    case 'expired':
      return notification.notification_type === 'document_expired'
    case 'expiring':
      return notification.notification_type === 'document_expiry'
  }
}

export default function NotificationsPage() {
  const auth = useRequireProfile()
  const companyId = auth.status === 'ready' ? auth.profile.company_id : null
  const userId = auth.status === 'ready' ? auth.profile.id : null

  const [alerts, setAlerts] = useState<DocumentAlert[] | null>(null)
  const [notifications, setNotifications] = useState<StoredNotification[] | null>(null)
  const [errors, setErrors] = useState({ alerts: false, notifications: false })
  const [reloadKey, setReloadKey] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    if (!companyId || !userId) return
    let cancelled = false

    async function load() {
      const [companyDocuments, workers, stored] = await Promise.all([
        loadCompanyDocuments(companyId!),
        loadWorkersWithDocuments(companyId!),
        loadStoredNotifications(companyId!, userId!),
      ])
      if (cancelled) return

      const alertsFailed = !companyDocuments || !workers
      setErrors({ alerts: alertsFailed, notifications: stored === null })
      setAlerts(alertsFailed ? null : buildDocumentAlerts(companyDocuments, workers))
      setNotifications(stored)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [companyId, userId, reloadKey])

  function reload() {
    setErrors({ alerts: false, notifications: false })
    setAlerts(null)
    setNotifications(null)
    setReloadKey((key) => key + 1)
  }

  async function updateRead(ids: string[], isRead: boolean) {
    if (!companyId || ids.length === 0) return

    setUpdatingIds((prev) => new Set([...prev, ...ids]))
    const result = await setNotificationRead(companyId, ids, isRead)
    setUpdatingIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })

    const updated = new Set(result.updatedIds)
    setNotifications((prev) =>
      (prev ?? []).map((n) => (updated.has(n.id) ? { ...n, is_read: isRead } : n))
    )
    if (result.error) setFeedback({ tone: 'error', message: result.error })
  }

  if (auth.status === 'loading') {
    return (
      <CenteredScreen>
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">Loading notifications…</p>
      </CenteredScreen>
    )
  }

  if (auth.status === 'error') {
    return (
      <CenteredScreen>
        <AuthErrorCard title={auth.title} message={auth.message} />
      </CenteredScreen>
    )
  }

  const loading =
    (alerts === null && !errors.alerts) || (notifications === null && !errors.notifications)

  const alertMessages = alertMessageSet(alerts ?? [])
  const unreadNotifications = (notifications ?? []).filter((n) => !n.is_read)
  const counts: Record<Filter, number> = {
    all:
      (alerts?.length ?? 0) +
      unreadNotifications.filter((n) => !isDuplicateOfAlert(n, alertMessages)).length,
    expired:
      (alerts?.filter((a) => a.status === 'expired').length ?? 0) +
      (notifications ?? []).filter((n) => notificationMatches(n, 'expired')).length,
    expiring:
      (alerts?.filter((a) => a.status === 'expiring').length ?? 0) +
      (notifications ?? []).filter((n) => notificationMatches(n, 'expiring')).length,
    unread: unreadNotifications.length,
  }

  const visibleAlerts = (alerts ?? []).filter((a) => alertMatches(a, filter))
  const visibleNotifications = (notifications ?? []).filter((n) =>
    notificationMatches(n, filter)
  )

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />

      <div className="mx-auto max-w-4xl space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <nav className="mb-2 text-sm text-slate-500">
              <Link href="/" className="hover:text-slate-900">
                Dashboard
              </Link>
              <span className="mx-2">/</span>
              <span className="text-slate-900">Notifications</span>
            </nav>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="mt-1 text-slate-500">
              {loading
                ? 'Loading…'
                : counts.all === 0
                  ? 'Nothing needs your attention right now.'
                  : `${counts.all} ${counts.all === 1 ? 'item needs' : 'items need'} your attention`}
            </p>
          </div>

          {unreadNotifications.length > 0 && (
            <button
              onClick={() => updateRead(unreadNotifications.map((n) => n.id), true)}
              disabled={updatingIds.size > 0}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Mark all as read
            </button>
          )}
        </div>

        {feedback && <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />}

        <div role="tablist" aria-label="Filter notifications" className="flex flex-wrap gap-2">
          {(Object.keys(filterLabels) as Filter[]).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                filter === key
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {filterLabels[key]}
              {!loading && (
                <span className={`ml-1.5 ${filter === key ? 'text-blue-100' : 'text-slate-400'}`}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Live document alerts */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-6">
            <h2 className="font-semibold">Document alerts</h2>
            <p className="mt-1 text-sm text-slate-500">
              Calculated live from expiry dates for company documents and active
              workers. They clear automatically when a document is renewed.
            </p>
          </div>

          {errors.alerts ? (
            <ErrorMessage text="We couldn't load document alerts." onRetry={reload} />
          ) : alerts === null ? (
            <LoadingMessage />
          ) : filter === 'unread' ? (
            <p className="p-6 text-sm text-slate-500">
              Document alerts don&apos;t have a read state. Switch to All, Expired
              or Expiring to see them.
            </p>
          ) : visibleAlerts.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              {alerts.length === 0
                ? 'No expired or expiring documents. Documents expiring within 30 days will appear here.'
                : `No ${filter} documents.`}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibleAlerts.map((alert) => (
                <li key={alert.id}>
                  <Link
                    href={alert.workerId ? `/workers/${alert.workerId}` : '/documents'}
                    className="flex items-start gap-3 px-6 py-4 text-sm hover:bg-slate-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        alert.status === 'expired' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{alert.message}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {alert.source === 'worker' ? `Worker · ${alert.subjectName}` : 'Company document'}
                        {' · '}
                        {alert.status === 'expired' ? 'Expired' : 'Expires'} {formatAlertDate(alert.expiryDate)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        alert.status === 'expired'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {alert.status === 'expired' ? 'Expired' : 'Expiring'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Stored notifications */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-6">
            <h2 className="font-semibold">Messages</h2>
            <p className="mt-1 text-sm text-slate-500">
              Notifications saved for your company or for you.
            </p>
          </div>

          {errors.notifications ? (
            <ErrorMessage text="We couldn't load your notifications." onRetry={reload} />
          ) : notifications === null ? (
            <LoadingMessage />
          ) : visibleNotifications.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              {notifications.length === 0
                ? 'No notifications yet.'
                : filter === 'unread'
                  ? "You're all caught up."
                  : 'No notifications match this filter.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibleNotifications.map((notification) => {
                const updating = updatingIds.has(notification.id)
                return (
                  <li
                    key={notification.id}
                    className={`flex flex-col gap-3 px-6 py-4 text-sm sm:flex-row sm:items-start ${
                      notification.is_read ? '' : 'bg-blue-50/40'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 hidden h-2 w-2 shrink-0 rounded-full sm:block ${
                        notification.is_read ? 'bg-transparent' : 'bg-blue-600'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={notification.is_read ? 'font-medium text-slate-700' : 'font-semibold'}>
                          {notification.title}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {typeLabels[notification.notification_type] ?? 'General'}
                        </span>
                        {!notification.is_read && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Unread
                          </span>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-slate-600">{notification.message}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {dateTimeFormatter.format(new Date(notification.created_at))}
                      </p>
                    </div>
                    <button
                      onClick={() => updateRead([notification.id], !notification.is_read)}
                      disabled={updating}
                      className="shrink-0 self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
                    >
                      {updating ? 'Saving…' : notification.is_read ? 'Mark as unread' : 'Mark as read'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

function LoadingMessage() {
  return (
    <div className="flex justify-center p-8">
      <Spinner />
    </div>
  )
}

function ErrorMessage({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="p-6 text-center text-sm">
      <p className="font-medium">{text}</p>
      <button onClick={onRetry} className="mt-3 font-medium text-blue-600 hover:text-blue-700">
        Try again
      </button>
    </div>
  )
}
