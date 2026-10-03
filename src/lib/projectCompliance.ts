import { supabase } from '@/lib/supabase'
import type { DocumentStatus } from '@/lib/documentStatus'
import type { HealthDocument } from '@/lib/readiness'

export type ChecklistItem = {
  id: string
  project_id: string
  item_name: string
  description: string | null
  required: boolean
  completed: boolean
  created_at: string
  updated_at: string | null
}

export type ChecklistFormValues = {
  itemName: string
  description: string
  required: boolean
}

export type ChecklistFormErrors = Partial<Record<keyof ChecklistFormValues, string>>

export type AssignedWorkerDocument = HealthDocument & {
  workerId: string
  workerName: string
}

const CHECKLIST_COLUMNS =
  'id, project_id, item_name, description, required, completed, created_at, updated_at'

const HEALTH_DOCUMENT_COLUMNS = 'id, document_type, expiry_date, status'

export const emptyChecklistFormValues: ChecklistFormValues = {
  itemName: '',
  description: '',
  required: true,
}

export function checklistItemToFormValues(item: ChecklistItem): ChecklistFormValues {
  return {
    itemName: item.item_name,
    description: item.description ?? '',
    required: item.required,
  }
}

export function validateChecklistForm(values: ChecklistFormValues): ChecklistFormErrors {
  const errors: ChecklistFormErrors = {}
  if (!values.itemName.trim()) {
    errors.itemName = 'Item name is required.'
  } else if (values.itemName.trim().length > 200) {
    errors.itemName = 'Item name must be 200 characters or fewer.'
  }
  if (values.description.trim().length > 1000) {
    errors.description = 'Description must be 1000 characters or fewer.'
  }
  return errors
}

type Result<T> = { data: T; error: null } | { data: null; error: string }

// The caller must only use these after the project has been loaded through
// the company-scoped project query. Every checklist query is also filtered by
// project_id, and RLS through the parent project is the security boundary.

export async function loadChecklist(projectId: string): Promise<ChecklistItem[] | null> {
  const { data, error } = await supabase
    .from('project_checklists')
    .select(CHECKLIST_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .overrideTypes<ChecklistItem[], { merge: false }>()

  return error ? null : (data ?? [])
}

export async function createChecklistItem(
  projectId: string,
  values: ChecklistFormValues
): Promise<Result<ChecklistItem>> {
  const { data, error } = await supabase
    .from('project_checklists')
    .insert({
      project_id: projectId,
      item_name: values.itemName.trim(),
      description: values.description.trim() || null,
      required: values.required,
      completed: false,
    })
    .select(CHECKLIST_COLUMNS)
    .single<ChecklistItem>()

  if (error || !data) {
    return { data: null, error: "We couldn't add this checklist item. Please try again." }
  }
  return { data, error: null }
}

async function updateChecklistRow(
  projectId: string,
  itemId: string,
  fields: Partial<Pick<ChecklistItem, 'item_name' | 'description' | 'required' | 'completed'>>
): Promise<Result<ChecklistItem>> {
  const { data, error } = await supabase
    .from('project_checklists')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('project_id', projectId)
    .select(CHECKLIST_COLUMNS)
    .maybeSingle<ChecklistItem>()

  if (error) {
    return { data: null, error: "We couldn't save this checklist item. Please try again." }
  }
  if (!data) {
    return {
      data: null,
      error: "This checklist item couldn't be found. It may have been deleted.",
    }
  }
  return { data, error: null }
}

export function updateChecklistItem(
  projectId: string,
  itemId: string,
  values: ChecklistFormValues
) {
  return updateChecklistRow(projectId, itemId, {
    item_name: values.itemName.trim(),
    description: values.description.trim() || null,
    required: values.required,
  })
}

export function setChecklistItemCompleted(
  projectId: string,
  itemId: string,
  completed: boolean
) {
  return updateChecklistRow(projectId, itemId, { completed })
}

export async function deleteChecklistItem(
  projectId: string,
  itemId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('project_checklists')
    .delete()
    .eq('id', itemId)
    .eq('project_id', projectId)
    .select('id')

  if (error) return "We couldn't delete this checklist item. Please try again."
  if (!data || data.length === 0) {
    return "This checklist item couldn't be deleted. It may already have been removed."
  }
  return null
}

type AssignmentWithDocuments = {
  workers: {
    id: string
    company_id: string
    full_name: string
    worker_documents: {
      id: string
      document_type: string
      expiry_date: string | null
      status: DocumentStatus | null
    }[]
  } | null
}

/**
 * Documents of the workers assigned to this project, via project_workers.
 * Workers outside the signed-in company are discarded as a defence in depth;
 * RLS should never return them in the first place.
 */
export async function loadAssignedWorkerDocuments(
  companyId: string,
  projectId: string
): Promise<AssignedWorkerDocument[] | null> {
  const { data, error } = await supabase
    .from('project_workers')
    .select(
      `workers(id, company_id, full_name, worker_documents(${HEALTH_DOCUMENT_COLUMNS}))`
    )
    .eq('project_id', projectId)
    .overrideTypes<AssignmentWithDocuments[], { merge: false }>()

  if (error) return null

  return (data ?? []).flatMap(({ workers: worker }) =>
    worker && worker.company_id === companyId
      ? (worker.worker_documents ?? []).map((document) => ({
          ...document,
          workerId: worker.id,
          workerName: worker.full_name,
        }))
      : []
  )
}

export async function loadCompanyDocumentHealth(
  companyId: string
): Promise<HealthDocument[] | null> {
  const { data, error } = await supabase
    .from('company_documents')
    .select(HEALTH_DOCUMENT_COLUMNS)
    .eq('company_id', companyId)
    .overrideTypes<HealthDocument[], { merge: false }>()

  return error ? null : (data ?? [])
}
