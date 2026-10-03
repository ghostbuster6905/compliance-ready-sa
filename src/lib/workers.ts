import { supabase } from '@/lib/supabase'
import { removeAllWorkerDocumentFiles } from '@/lib/workerDocuments'

export type WorkerStatus = 'active' | 'inactive'

export type Worker = {
  id: string
  company_id: string
  full_name: string
  id_number: string | null
  phone: string | null
  trade: string | null
  status: WorkerStatus
  created_at: string
  updated_at: string | null
}

export type WorkerFormValues = {
  fullName: string
  idNumber: string
  phone: string
  trade: string
  status: WorkerStatus
}

export type WorkerFormErrors = Partial<Record<keyof WorkerFormValues, string>>

export const WORKER_COLUMNS =
  'id, company_id, full_name, id_number, phone, trade, status, created_at, updated_at'

export const workerStatusLabels: Record<WorkerStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

export const emptyWorkerFormValues: WorkerFormValues = {
  fullName: '',
  idNumber: '',
  phone: '',
  trade: '',
  status: 'active',
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export function workerToFormValues(worker: Worker): WorkerFormValues {
  return {
    fullName: worker.full_name,
    idNumber: worker.id_number ?? '',
    phone: worker.phone ?? '',
    trade: worker.trade ?? '',
    status: worker.status,
  }
}

export function validateWorkerForm(values: WorkerFormValues): WorkerFormErrors {
  const errors: WorkerFormErrors = {}

  if (!values.fullName.trim()) {
    errors.fullName = 'Full name is required.'
  } else if (values.fullName.trim().length > 200) {
    errors.fullName = 'Full name must be 200 characters or fewer.'
  }

  // Accepts SA ID numbers and passport numbers, so only the shape is checked.
  if (values.idNumber.trim() && !/^[A-Za-z0-9 -]{4,20}$/.test(values.idNumber.trim())) {
    errors.idNumber = 'Enter a valid ID or passport number (letters and numbers only).'
  }

  if (values.phone.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(values.phone.trim())) {
    errors.phone = 'Enter a valid phone number, e.g. 082 123 4567.'
  }

  if (values.trade.trim().length > 100) {
    errors.trade = 'Trade must be 100 characters or fewer.'
  }

  if (values.status !== 'active' && values.status !== 'inactive') {
    errors.status = 'Choose a valid status.'
  }

  return errors
}

function toWorkerFields(values: WorkerFormValues) {
  return {
    full_name: values.fullName.trim(),
    id_number: values.idNumber.trim() || null,
    phone: values.phone.trim() || null,
    trade: values.trade.trim() || null,
    status: values.status,
  }
}

export function sortWorkers(workers: Worker[]) {
  return [...workers].sort((a, b) => a.full_name.localeCompare(b.full_name))
}

const digitsOnly = (value: string) => value.replace(/\D/g, '')

/** Case-insensitive match on name, trade, phone and ID number. */
export function workerMatchesSearch(worker: Worker, query: string) {
  const text = query.trim().toLowerCase()
  if (!text) return true

  const fields = [worker.full_name, worker.trade, worker.phone, worker.id_number]
  if (fields.some((field) => field?.toLowerCase().includes(text))) return true

  // Lets "0821234567" match "082 123 4567" and vice versa.
  const digits = digitsOnly(text)
  return (
    digits.length > 0 &&
    [worker.phone, worker.id_number].some((field) =>
      field ? digitsOnly(field).includes(digits) : false
    )
  )
}

type Result<T> = { data: T; error: null } | { data: null; error: string }

// All queries are scoped to the signed-in user's company_id from their
// profile. RLS on public.workers is the actual security boundary.

export async function createWorker(
  companyId: string,
  values: WorkerFormValues
): Promise<Result<Worker>> {
  const { data, error } = await supabase
    .from('workers')
    .insert({ ...toWorkerFields(values), company_id: companyId })
    .select(WORKER_COLUMNS)
    .single<Worker>()

  if (error || !data) {
    return { data: null, error: "We couldn't add this worker. Please try again." }
  }
  return { data, error: null }
}

export async function updateWorker(
  companyId: string,
  workerId: string,
  values: WorkerFormValues
): Promise<Result<Worker>> {
  const { data, error } = await supabase
    .from('workers')
    .update({ ...toWorkerFields(values), updated_at: new Date().toISOString() })
    .eq('id', workerId)
    .eq('company_id', companyId)
    .select(WORKER_COLUMNS)
    .maybeSingle<Worker>()

  if (error) {
    return { data: null, error: "We couldn't save your changes. Please try again." }
  }
  if (!data) {
    return {
      data: null,
      error: "This worker couldn't be found. They may have been deleted.",
    }
  }
  return { data, error: null }
}

export async function deleteWorker(
  companyId: string,
  workerId: string
): Promise<string | null> {
  // Remove project assignments first so a project_workers foreign key without
  // ON DELETE CASCADE can't block the delete after files are already gone.
  const { error: unassignError } = await supabase
    .from('project_workers')
    .delete()
    .eq('worker_id', workerId)
  if (unassignError) {
    return "We couldn't remove this worker from their projects, so the worker was kept. Please try again."
  }

  // Deleting the worker cascades to worker_documents rows, but Storage files
  // must be removed explicitly first or they would be left behind.
  const filesRemoved = await removeAllWorkerDocumentFiles({ companyId, workerId })
  if (!filesRemoved) {
    return "We couldn't delete this worker's document files, so the worker was kept. Please try again."
  }

  const { data, error } = await supabase
    .from('workers')
    .delete()
    .eq('id', workerId)
    .eq('company_id', companyId)
    .select('id')

  if (error) return "We couldn't delete this worker. Please try again."
  if (!data || data.length === 0) {
    return "This worker couldn't be deleted. They may already have been removed."
  }
  return null
}
