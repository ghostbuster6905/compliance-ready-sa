'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useRequireProfile } from '@/lib/useRequireProfile'
import { isUuid } from '@/lib/workers'
import {
  deleteProject,
  PROJECT_COLUMNS,
  projectToFormValues,
  type Project,
} from '@/lib/projects'
import {
  AppHeader,
  AuthErrorCard,
  CenteredScreen,
  FeedbackBanner,
  Spinner,
  useFeedback,
} from '@/app/workers/WorkerComponents'
import {
  DeleteProjectModal,
  formatProjectDate,
  ProjectFormModal,
  ProjectStatusBadge,
} from '../ProjectComponents'
import { AssignedWorkersSection } from '../AssignedWorkersSection'
import { ProjectComplianceSection } from '../ProjectComplianceSection'

type ProjectState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; project: Project }

export default function ProjectProfilePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const auth = useRequireProfile()
  const companyId = auth.status === 'ready' ? auth.profile.company_id : null

  const [state, setState] = useState<ProjectState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [assignmentVersion, setAssignmentVersion] = useState(0)
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function loadProject() {
      // A malformed ID can't match any project; skip the query.
      if (!isUuid(projectId)) {
        setState({ status: 'not-found' })
        return
      }

      // Scoped to the user's company; RLS also hides other companies' rows,
      // so another company's project looks exactly like a missing one.
      const { data, error } = await supabase
        .from('projects')
        .select(PROJECT_COLUMNS)
        .eq('id', projectId)
        .eq('company_id', companyId)
        .maybeSingle<Project>()
      if (cancelled) return

      if (error) {
        setState({ status: 'error' })
        return
      }

      setState(data ? { status: 'ready', project: data } : { status: 'not-found' })
    }

    loadProject()

    return () => {
      cancelled = true
    }
  }, [companyId, projectId, reloadKey])

  async function handleDelete(project: Project): Promise<string | null> {
    if (!companyId) return 'Your session is not ready yet.'

    const error = await deleteProject(companyId, project.id)
    if (error) return error

    router.replace('/projects')
    return null
  }

  if (auth.status === 'loading') {
    return (
      <CenteredScreen>
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">Loading project…</p>
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

  const project = state.status === 'ready' ? state.project : null

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />

      <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
        <nav className="text-sm text-slate-500">
          <Link href="/" className="hover:text-slate-900">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          <Link href="/projects" className="hover:text-slate-900">
            Projects
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{project?.project_name ?? 'Project'}</span>
        </nav>

        {state.status === 'loading' ? (
          <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-10 shadow-sm">
            <Spinner />
            <p className="mt-4 text-sm text-slate-500">Loading project…</p>
          </div>
        ) : state.status === 'error' ? (
          <MessageCard
            title="We couldn't load this project"
            message="Please check your connection and try again."
            action={
              <button
                onClick={() => {
                  setState({ status: 'loading' })
                  setReloadKey((key) => key + 1)
                }}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Try again
              </button>
            }
          />
        ) : state.status === 'not-found' ? (
          <MessageCard
            title="Project not found"
            message="This project doesn't exist or isn't part of your company."
            action={
              <Link
                href="/projects"
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                ← Back to Projects
              </Link>
            }
          />
        ) : (
          project &&
          companyId && (
            <>
              {feedback && (
                <FeedbackBanner
                  feedback={feedback}
                  onDismiss={() => setFeedback(null)}
                />
              )}

              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl text-blue-600">
                      ▤
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold">{project.project_name}</h1>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span>{project.client_name || 'No client set'}</span>
                        <ProjectStatusBadge status={project.status} />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditing(true)}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleting(true)}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <dl className="grid gap-6 p-6 sm:grid-cols-2">
                  <Detail label="Project Name" value={project.project_name} />
                  <Detail label="Client" value={project.client_name} />
                  <div className="sm:col-span-2">
                    <Detail label="Address" value={project.address} />
                  </div>
                  <Detail label="Start Date" value={formatDateOrNull(project.start_date)} />
                  <Detail label="End Date" value={formatDateOrNull(project.end_date)} />
                  <div>
                    <dt className="text-sm text-slate-500">Status</dt>
                    <dd className="mt-1">
                      <ProjectStatusBadge status={project.status} />
                    </dd>
                  </div>
                </dl>
              </section>

              <AssignedWorkersSection
                companyId={companyId}
                projectId={project.id}
                onAssignmentsChange={() => setAssignmentVersion((v) => v + 1)}
              />

              <ProjectComplianceSection
                companyId={companyId}
                projectId={project.id}
                assignmentVersion={assignmentVersion}
              />
            </>
          )
        )}
      </div>

      {editing && project && companyId && (
        <ProjectFormModal
          companyId={companyId}
          project={project}
          initialValues={projectToFormValues(project)}
          onSaved={(saved) => {
            setState({ status: 'ready', project: saved })
            setEditing(false)
            setFeedback({ tone: 'success', message: 'Project details updated.' })
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {deleting && project && (
        <DeleteProjectModal
          project={project}
          onConfirm={() => handleDelete(project)}
          onClose={() => setDeleting(false)}
        />
      )}
    </main>
  )
}

function formatDateOrNull(isoDate: string | null) {
  return isoDate ? formatProjectDate(isoDate) : null
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-line font-medium">
        {value || <span className="font-normal text-slate-400">Not provided</span>}
      </dd>
    </div>
  )
}

function MessageCard({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <div className="mt-6">{action}</div>
    </div>
  )
}
