'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRequireProfile } from '@/lib/useRequireProfile'
import {
  deletePack,
  loadCreatorNames,
  loadPacks,
  type CompliancePack,
  type PackProject,
} from '@/lib/compliancePacks'
import {
  AppHeader,
  AuthErrorCard,
  CenteredScreen,
  FeedbackBanner,
  Modal,
  Spinner,
  useFeedback,
} from '@/app/workers/WorkerComponents'
import {
  DeletePackModal,
  downloadPack,
  GeneratePackModal,
  ModalFooter,
  PackStatusBadge,
} from './PackComponents'

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export default function CompliancePacksPage() {
  const auth = useRequireProfile()
  const profile = auth.status === 'ready' ? auth.profile : null
  const companyId = profile?.company_id ?? null

  const [packs, setPacks] = useState<CompliancePack[] | null>(null)
  const [creatorNames, setCreatorNames] = useState<Map<string, string>>(new Map())
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [pickingProject, setPickingProject] = useState(false)
  const [generateFor, setGenerateFor] = useState<PackProject | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CompliancePack | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useFeedback()

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function load() {
      const result = await loadPacks(companyId!)
      if (cancelled) return
      if (!result) {
        setLoadError(true)
        return
      }
      setLoadError(false)
      setPacks(result)

      const names = await loadCreatorNames(
        result.map((p) => p.generated_by).filter((id): id is string => Boolean(id))
      )
      if (!cancelled) setCreatorNames(names)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [companyId, reloadKey])

  function reload() {
    setLoadError(false)
    setPacks(null)
    setReloadKey((key) => key + 1)
  }

  function creatorLabel(pack: CompliancePack) {
    if (!pack.generated_by) return 'Removed user'
    if (pack.generated_by === profile?.id) return 'You'
    return creatorNames.get(pack.generated_by) ?? 'Team member'
  }

  async function handleDownload(pack: CompliancePack) {
    if (!companyId) return
    setDownloadingId(pack.id)
    const error = await downloadPack(companyId, pack)
    setDownloadingId(null)
    if (error) setFeedback({ tone: 'error', message: error })
  }

  async function handleDelete(pack: CompliancePack): Promise<string | null> {
    if (!companyId) return 'Your session is not ready yet.'
    const error = await deletePack(companyId, pack)
    if (error) return error

    setPacks((prev) => (prev ?? []).filter((p) => p.id !== pack.id))
    setDeleteTarget(null)
    setFeedback({ tone: 'success', message: `${pack.pack_name} was deleted.` })
    return null
  }

  if (auth.status === 'loading') {
    return (
      <CenteredScreen>
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">Loading compliance packs…</p>
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

  const query = search.trim().toLowerCase()
  const filtered =
    packs?.filter(
      (p) =>
        !query ||
        [p.pack_name, p.project_name, creatorLabel(p)].some((field) =>
          field.toLowerCase().includes(query)
        )
    ) ?? []
  const packCount = packs?.length ?? 0

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
              <span className="text-slate-900">Compliance Packs</span>
            </nav>
            <h1 className="text-2xl font-bold">Compliance Packs</h1>
            <p className="mt-1 text-slate-500">
              {packs === null
                ? 'Loading packs…'
                : `${packCount} ${packCount === 1 ? 'pack' : 'packs'} · ZIP archives of selected project documents`}
            </p>
          </div>

          <button
            onClick={() => setPickingProject(true)}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            + Generate Pack
          </button>
        </div>

        {feedback && <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loadError ? (
            <div className="p-10 text-center">
              <p className="font-medium">We couldn&apos;t load your compliance packs.</p>
              <button
                onClick={reload}
                className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Try again
              </button>
            </div>
          ) : packs === null ? (
            <div className="flex flex-col items-center p-10">
              <Spinner />
              <p className="mt-4 text-sm text-slate-500">Loading packs…</p>
            </div>
          ) : packs.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-xl text-blue-600">
                ▧
              </div>
              <h2 className="mt-4 font-semibold">No compliance packs yet.</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                Bundle selected company and worker documents for a project into
                a single ZIP you can share with a client or site.
              </p>
              <button
                onClick={() => setPickingProject(true)}
                className="mt-6 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
              >
                Generate Pack
              </button>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 p-4 sm:px-6">
                <label htmlFor="pack-search" className="sr-only">
                  Search packs
                </label>
                <input
                  id="pack-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by pack, project or creator"
                  className="block w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                {query && (
                  <p className="mt-2 text-xs text-slate-500">
                    Showing {filtered.length} of {packCount}
                  </p>
                )}
              </div>

              {filtered.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="font-medium">No packs match “{search.trim()}”.</p>
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
                          <th className="px-6 py-3 font-medium">Pack Name</th>
                          <th className="px-6 py-3 font-medium">Project</th>
                          <th className="px-6 py-3 font-medium">Generated By</th>
                          <th className="px-6 py-3 font-medium">Status</th>
                          <th className="px-6 py-3 font-medium">Created</th>
                          <th className="px-6 py-3 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filtered.map((pack) => (
                          <tr key={pack.id} className="hover:bg-slate-50/60">
                            <td className="px-6 py-4 font-medium">{pack.pack_name}</td>
                            <td className="px-6 py-4">
                              <Link
                                href={`/projects/${pack.project_id}`}
                                className="text-slate-600 hover:text-blue-600"
                              >
                                {pack.project_name}
                              </Link>
                            </td>
                            <td className="px-6 py-4 text-slate-600">{creatorLabel(pack)}</td>
                            <td className="px-6 py-4">
                              <PackStatusBadge status={pack.status} />
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                              {dateTimeFormatter.format(new Date(pack.created_at))}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right">
                              <PackActions
                                pack={pack}
                                downloading={downloadingId === pack.id}
                                onDownload={() => handleDownload(pack)}
                                onDelete={() => setDeleteTarget(pack)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile list */}
                  <ul className="divide-y divide-slate-100 md:hidden">
                    {filtered.map((pack) => (
                      <li key={pack.id} className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="font-medium">{pack.pack_name}</div>
                            <Link
                              href={`/projects/${pack.project_id}`}
                              className="text-xs text-slate-500 hover:text-blue-600"
                            >
                              {pack.project_name}
                            </Link>
                          </div>
                          <PackStatusBadge status={pack.status} />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {creatorLabel(pack)} · {dateTimeFormatter.format(new Date(pack.created_at))}
                        </p>
                        <div className="mt-3">
                          <PackActions
                            pack={pack}
                            downloading={downloadingId === pack.id}
                            onDownload={() => handleDownload(pack)}
                            onDelete={() => setDeleteTarget(pack)}
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

        <p className="text-xs text-slate-500">
          Compliance packs contain records selected from ComplianceReady SA to
          help organise documents and project readiness. They do not certify
          legal compliance; requirements may vary by client, site, project and
          applicable law.
        </p>
      </div>

      {pickingProject && companyId && (
        <ProjectPickerModal
          companyId={companyId}
          onSelect={(project) => {
            setPickingProject(false)
            setGenerateFor(project)
          }}
          onClose={() => setPickingProject(false)}
        />
      )}

      {generateFor && profile && (
        <GeneratePackModal
          companyId={profile.company_id}
          userId={profile.id}
          userName={profile.full_name}
          project={generateFor}
          onGenerated={(pack) => setPacks((prev) => [pack, ...(prev ?? [])])}
          onClose={() => setGenerateFor(null)}
        />
      )}

      {deleteTarget && (
        <DeletePackModal
          pack={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </main>
  )
}

function PackActions({
  pack,
  downloading,
  onDownload,
  onDelete,
}: {
  pack: CompliancePack
  downloading: boolean
  onDownload: () => void
  onDelete: () => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-2">
      {pack.status === 'generated' && pack.file_path && (
        <button
          onClick={onDownload}
          disabled={downloading}
          className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-60"
        >
          {downloading ? 'Preparing…' : 'Download'}
        </button>
      )}
      <button
        onClick={onDelete}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    </div>
  )
}

function ProjectPickerModal({
  companyId,
  onSelect,
  onClose,
}: {
  companyId: string
  onSelect: (project: PackProject) => void
  onClose: () => void
}) {
  const [projects, setProjects] = useState<(PackProject & { status: string })[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('projects')
      .select('id, project_name, client_name, address, status')
      .eq('company_id', companyId)
      .order('project_name')
      .overrideTypes<(PackProject & { status: string })[], { merge: false }>()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setLoadError(true)
        else setProjects(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  const selectedProject = projects?.find((p) => p.id === selectedId) ?? null

  return (
    <Modal title="Choose a project" titleId="pick-project-title" onClose={onClose} dismissable>
      <div className="p-6">
        {loadError ? (
          <p className="text-sm text-red-700">We couldn&apos;t load your projects. Please try again.</p>
        ) : projects === null ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : projects.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-600">
            <p>You don&apos;t have any projects yet.</p>
            <Link href="/projects" className="mt-3 inline-block font-medium text-blue-600 hover:text-blue-700">
              Go to Projects
            </Link>
          </div>
        ) : (
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {projects.map((project) => (
              <li key={project.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <input
                    type="radio"
                    name="pack-project"
                    checked={selectedId === project.id}
                    onChange={() => setSelectedId(project.id)}
                    className="h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{project.project_name}</span>
                    <span className="block text-xs text-slate-500">
                      {project.client_name || 'No client set'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => selectedProject && onSelect(selectedProject)}
          disabled={!selectedProject}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Continue
        </button>
      </ModalFooter>
    </Modal>
  )
}
