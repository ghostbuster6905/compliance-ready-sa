'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRequireProfile } from '@/lib/useRequireProfile'
import {
  deleteProject,
  emptyProjectFormValues,
  PROJECT_COLUMNS,
  projectMatchesSearch,
  projectToFormValues,
  sortProjects,
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
} from './ProjectComponents'

type FormState = { mode: 'add' } | { mode: 'edit'; project: Project } | null

export default function ProjectsPage() {
  const auth = useRequireProfile()
  const companyId = auth.status === 'ready' ? auth.profile.company_id : null

  const [projects, setProjects] = useState<Project[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [formState, setFormState] = useState<FormState>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function loadProjects() {
      const { data, error } = await supabase
        .from('projects')
        .select(PROJECT_COLUMNS)
        .eq('company_id', companyId)
        .overrideTypes<Project[], { merge: false }>()
      if (cancelled) return

      if (error) {
        setLoadError("We couldn't load your projects. Please try again.")
        return
      }

      setLoadError(null)
      setProjects(sortProjects(data ?? []))
    }

    loadProjects()

    return () => {
      cancelled = true
    }
  }, [companyId, reloadKey])

  function retryLoad() {
    setLoadError(null)
    setProjects(null)
    setReloadKey((key) => key + 1)
  }

  function handleSaved(saved: Project) {
    const isAdd = formState?.mode === 'add'
    setProjects((prev) =>
      sortProjects(
        isAdd
          ? [...(prev ?? []), saved]
          : (prev ?? []).map((p) => (p.id === saved.id ? saved : p))
      )
    )
    setFormState(null)
    setFeedback({
      tone: 'success',
      message: `${saved.project_name} was ${isAdd ? 'added' : 'updated'}.`,
    })
  }

  async function handleDelete(project: Project): Promise<string | null> {
    if (!companyId) return 'Your session is not ready yet.'

    const error = await deleteProject(companyId, project.id)
    if (error) return error

    setProjects((prev) => (prev ?? []).filter((p) => p.id !== project.id))
    setDeleteTarget(null)
    setFeedback({ tone: 'success', message: `${project.project_name} was deleted.` })
    return null
  }

  if (auth.status === 'loading') {
    return (
      <CenteredScreen>
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">Loading projects…</p>
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

  const filteredProjects =
    projects?.filter((p) => projectMatchesSearch(p, search)) ?? []
  const projectCount = projects?.length ?? 0
  const activeCount = projects?.filter((p) => p.status === 'active').length ?? 0
  const isSearching = search.trim().length > 0

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />

      <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <nav className="mb-2 text-sm text-slate-500">
              <Link href="/" className="hover:text-slate-900">
                Dashboard
              </Link>
              <span className="mx-2">/</span>
              <span className="text-slate-900">Projects</span>
            </nav>
            <h1 className="text-2xl font-bold">Projects</h1>
            <p className="mt-1 text-slate-500">
              {projects === null
                ? 'Loading projects…'
                : `${projectCount} ${projectCount === 1 ? 'project' : 'projects'} · ${activeCount} active`}
            </p>
          </div>

          <button
            onClick={() => setFormState({ mode: 'add' })}
            disabled={projects === null}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Add Project
          </button>
        </div>

        {feedback && (
          <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
        )}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loadError ? (
            <div className="p-10 text-center">
              <p className="font-medium">{loadError}</p>
              <button
                onClick={retryLoad}
                className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Try again
              </button>
            </div>
          ) : projects === null ? (
            <div className="flex flex-col items-center p-10">
              <Spinner />
              <p className="mt-4 text-sm text-slate-500">Loading projects…</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-xl text-blue-600">
                ▤
              </div>
              <h2 className="mt-4 font-semibold">No projects yet.</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                Add the sites and contracts you&apos;re working on, then assign
                the workers who will be on site.
              </p>
              <button
                onClick={() => setFormState({ mode: 'add' })}
                className="mt-6 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
              >
                Add Project
              </button>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 p-4 sm:px-6">
                <label htmlFor="project-search" className="sr-only">
                  Search projects
                </label>
                <div className="relative max-w-md">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400"
                  >
                    ⌕
                  </span>
                  <input
                    id="project-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by project, client or address"
                    className="block w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {isSearching && (
                  <p className="mt-2 text-xs text-slate-500">
                    Showing {filteredProjects.length} of {projectCount}
                  </p>
                )}
              </div>

              {filteredProjects.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="font-medium">No projects match “{search.trim()}”.</p>
                  <button
                    onClick={() => setSearch('')}
                    className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-6 py-3 font-medium">Project Name</th>
                          <th className="px-6 py-3 font-medium">Client</th>
                          <th className="px-6 py-3 font-medium">Address</th>
                          <th className="px-6 py-3 font-medium">Start Date</th>
                          <th className="px-6 py-3 font-medium">End Date</th>
                          <th className="px-6 py-3 font-medium">Status</th>
                          <th className="px-6 py-3 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredProjects.map((project) => (
                          <tr key={project.id} className="hover:bg-slate-50/60">
                            <td className="px-6 py-4 font-medium">
                              <Link
                                href={`/projects/${project.id}`}
                                className="hover:text-blue-600"
                              >
                                {project.project_name}
                              </Link>
                            </td>
                            <td className="px-6 py-4 text-slate-600">
                              <Value text={project.client_name} />
                            </td>
                            <td className="max-w-xs px-6 py-4 text-slate-600">
                              <span className="line-clamp-2">
                                <Value text={project.address} />
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                              {formatProjectDate(project.start_date)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                              {formatProjectDate(project.end_date)}
                            </td>
                            <td className="px-6 py-4">
                              <ProjectStatusBadge status={project.status} />
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right">
                              <RowActions
                                project={project}
                                onEdit={() => setFormState({ mode: 'edit', project })}
                                onDelete={() => setDeleteTarget(project)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile list */}
                  <ul className="divide-y divide-slate-100 md:hidden">
                    {filteredProjects.map((project) => (
                      <li key={project.id} className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <Link
                              href={`/projects/${project.id}`}
                              className="font-medium hover:text-blue-600"
                            >
                              {project.project_name}
                            </Link>
                            <div className="text-xs text-slate-500">
                              {project.client_name || 'No client set'}
                            </div>
                          </div>
                          <ProjectStatusBadge status={project.status} />
                        </div>
                        {project.address && (
                          <p className="mt-2 text-xs text-slate-500">{project.address}</p>
                        )}
                        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <dt className="text-slate-500">Start</dt>
                            <dd className="font-medium">
                              {formatProjectDate(project.start_date)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">End</dt>
                            <dd className="font-medium">
                              {formatProjectDate(project.end_date)}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-3">
                          <RowActions
                            project={project}
                            onEdit={() => setFormState({ mode: 'edit', project })}
                            onDelete={() => setDeleteTarget(project)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {formState && companyId && (
        <ProjectFormModal
          key={formState.mode === 'edit' ? formState.project.id : 'add'}
          companyId={companyId}
          project={formState.mode === 'edit' ? formState.project : null}
          initialValues={
            formState.mode === 'edit'
              ? projectToFormValues(formState.project)
              : emptyProjectFormValues
          }
          onSaved={handleSaved}
          onClose={() => setFormState(null)}
        />
      )}

      {deleteTarget && (
        <DeleteProjectModal
          project={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </main>
  )
}

function Value({ text }: { text: string | null }) {
  return text ? <>{text}</> : <span className="text-slate-400">—</span>
}

function RowActions({
  project,
  onEdit,
  onDelete,
}: {
  project: Project
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-2">
      <Link
        href={`/projects/${project.id}`}
        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
      >
        View
      </Link>
      <button
        onClick={onEdit}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    </div>
  )
}
