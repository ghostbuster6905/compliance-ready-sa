import { supabase } from '@/lib/supabase'
import type { WorkerStatus } from '@/lib/workers'

export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived'

export type Project = {
  id: string
  company_id: string
  project_name: string
  client_name: string | null
  address: string | null
  start_date: string | null
  end_date: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string | null
}

export type ProjectFormValues = {
  projectName: string
  clientName: string
  address: string
  startDate: string
  endDate: string
  status: ProjectStatus
}

export type ProjectFormErrors = Partial<Record<keyof ProjectFormValues, string>>

export type AssignedWorker = {
  assignmentId: string
  assignedAt: string
  worker: {
    id: string
    full_name: string
    trade: string | null
    phone: string | null
    status: WorkerStatus
  }
}

export const PROJECT_COLUMNS =
  'id, company_id, project_name, client_name, address, start_date, end_date, status, created_at, updated_at'

export const PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'active',
  'completed',
  'archived',
]

export const projectStatusLabels: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
}

export const emptyProjectFormValues: ProjectFormValues = {
  projectName: '',
  clientName: '',
  address: '',
  startDate: '',
  endDate: '',
  status: 'planning',
}

// Postgres error codes returned by PostgREST.
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

export function projectToFormValues(project: Project): ProjectFormValues {
  return {
    projectName: project.project_name,
    clientName: project.client_name ?? '',
    address: project.address ?? '',
    startDate: project.start_date ?? '',
    endDate: project.end_date ?? '',
    status: project.status,
  }
}

export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {}

  if (!values.projectName.trim()) {
    errors.projectName = 'Project name is required.'
  } else if (values.projectName.trim().length > 200) {
    errors.projectName = 'Project name must be 200 characters or fewer.'
  }

  if (values.clientName.trim().length > 200) {
    errors.clientName = 'Client name must be 200 characters or fewer.'
  }

  if (values.address.trim().length > 500) {
    errors.address = 'Address must be 500 characters or fewer.'
  }

  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = 'End date cannot be before the start date.'
  }

  if (!PROJECT_STATUSES.includes(values.status)) {
    errors.status = 'Choose a valid status.'
  }

  return errors
}

function toProjectFields(values: ProjectFormValues) {
  return {
    project_name: values.projectName.trim(),
    client_name: values.clientName.trim() || null,
    address: values.address.trim() || null,
    start_date: values.startDate || null,
    end_date: values.endDate || null,
    status: values.status,
  }
}

export function sortProjects(projects: Project[]) {
  return [...projects].sort((a, b) => a.project_name.localeCompare(b.project_name))
}

/** Case-insensitive match on project name, client name and address. */
export function projectMatchesSearch(project: Project, query: string) {
  const text = query.trim().toLowerCase()
  if (!text) return true
  return [project.project_name, project.client_name, project.address].some(
    (field) => field?.toLowerCase().includes(text)
  )
}

type Result<T> = { data: T; error: null } | { data: null; error: string }

// All queries are scoped to the signed-in user's company_id from their
// profile. RLS on public.projects / public.project_workers is the actual
// security boundary.

export async function createProject(
  companyId: string,
  values: ProjectFormValues
): Promise<Result<Project>> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ ...toProjectFields(values), company_id: companyId })
    .select(PROJECT_COLUMNS)
    .single<Project>()

  if (error || !data) {
    return { data: null, error: "We couldn't add this project. Please try again." }
  }
  return { data, error: null }
}

export async function updateProject(
  companyId: string,
  projectId: string,
  values: ProjectFormValues
): Promise<Result<Project>> {
  const { data, error } = await supabase
    .from('projects')
    .update({ ...toProjectFields(values), updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('company_id', companyId)
    .select(PROJECT_COLUMNS)
    .maybeSingle<Project>()

  if (error) {
    return { data: null, error: "We couldn't save your changes. Please try again." }
  }
  if (!data) {
    return {
      data: null,
      error: "This project couldn't be found. It may have been deleted.",
    }
  }
  return { data, error: null }
}

async function deleteProjectRow(companyId: string, projectId: string) {
  return supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('company_id', companyId)
    .select('id')
}

/**
 * Deletes a project. Workers themselves are never deleted. If the database
 * does not cascade project_workers on delete, the project's assignments are
 * removed explicitly and the delete is retried once.
 */
export async function deleteProject(
  companyId: string,
  projectId: string
): Promise<string | null> {
  let { data, error } = await deleteProjectRow(companyId, projectId)

  if (error?.code === FOREIGN_KEY_VIOLATION) {
    const { error: unassignError } = await supabase
      .from('project_workers')
      .delete()
      .eq('project_id', projectId)

    if (unassignError) {
      return "This project has assigned workers that couldn't be removed, so it was kept. Please try again."
    }

    ;({ data, error } = await deleteProjectRow(companyId, projectId))

    if (error?.code === FOREIGN_KEY_VIOLATION) {
      return 'Workers were unassigned from this project, but other linked records still prevent it from being deleted.'
    }
  }

  if (error) return "We couldn't delete this project. Please try again."
  if (!data || data.length === 0) {
    return "This project couldn't be deleted. It may already have been removed."
  }
  return null
}

type AssignmentRow = {
  id: string
  assigned_at: string
  workers: AssignedWorker['worker'] | null
}

export async function loadAssignedWorkers(
  projectId: string
): Promise<AssignedWorker[] | null> {
  const { data, error } = await supabase
    .from('project_workers')
    .select('id, assigned_at, workers(id, full_name, trade, phone, status)')
    .eq('project_id', projectId)
    .overrideTypes<AssignmentRow[], { merge: false }>()

  if (error) return null

  return (data ?? [])
    .filter((row): row is AssignmentRow & { workers: AssignedWorker['worker'] } =>
      Boolean(row.workers)
    )
    .map((row) => ({
      assignmentId: row.id,
      assignedAt: row.assigned_at,
      worker: row.workers,
    }))
    .sort((a, b) => a.worker.full_name.localeCompare(b.worker.full_name))
}

/**
 * Assigns workers to a project. The project must already have been loaded
 * through the company-scoped query; the worker IDs are re-checked against
 * the company here so only the company's own workers are inserted. The
 * unique(project_id, worker_id) constraint prevents duplicates.
 */
export async function assignWorkers(
  companyId: string,
  projectId: string,
  workerIds: string[]
): Promise<{ error: string | null; duplicate: boolean }> {
  if (workerIds.length === 0) return { error: null, duplicate: false }

  const { data: allowed, error: checkError } = await supabase
    .from('workers')
    .select('id')
    .eq('company_id', companyId)
    .in('id', workerIds)

  if (checkError) {
    return {
      error: "We couldn't verify the selected workers. Please try again.",
      duplicate: false,
    }
  }

  const allowedIds = new Set((allowed ?? []).map((w) => w.id as string))
  if (workerIds.some((id) => !allowedIds.has(id))) {
    return {
      error: 'One or more selected workers are no longer available. Please refresh and try again.',
      duplicate: false,
    }
  }

  const { error } = await supabase
    .from('project_workers')
    .insert(workerIds.map((workerId) => ({ project_id: projectId, worker_id: workerId })))

  if (error?.code === UNIQUE_VIOLATION) {
    return {
      error: 'Some of these workers were already assigned to this project. The list has been refreshed; please review and try again.',
      duplicate: true,
    }
  }
  if (error) {
    return { error: "We couldn't assign these workers. Please try again.", duplicate: false }
  }
  return { error: null, duplicate: false }
}

/** Deletes only the project_workers assignment row; the worker is untouched. */
export async function removeAssignment(
  projectId: string,
  assignmentId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('project_workers')
    .delete()
    .eq('id', assignmentId)
    .eq('project_id', projectId)
    .select('id')

  if (error) return "We couldn't remove this worker from the project. Please try again."
  if (!data || data.length === 0) {
    return 'This assignment could not be found. It may already have been removed.'
  }
  return null
}
