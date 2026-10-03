'use client'

import { useState, type SubmitEvent } from 'react'
import {
  createProject,
  PROJECT_STATUSES,
  projectStatusLabels,
  updateProject,
  validateProjectForm,
  type Project,
  type ProjectFormErrors,
  type ProjectFormValues,
  type ProjectStatus,
} from '@/lib/projects'
import { FormField, inputClasses, Modal } from '@/app/workers/WorkerComponents'

const statusBadgeClasses: Record<ProjectStatus, string> = {
  planning: 'bg-blue-50 text-blue-700',
  active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-indigo-50 text-indigo-700',
  archived: 'bg-slate-100 text-slate-600',
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatProjectDate(isoDate: string | null) {
  if (!isoDate) return '—'
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
        statusBadgeClasses[status] ?? statusBadgeClasses.archived
      }`}
    >
      {projectStatusLabels[status] ?? status}
    </span>
  )
}

/**
 * Add/Edit project form. company_id is never a form field: it is passed in
 * from the signed-in user's profile.
 */
export function ProjectFormModal({
  companyId,
  project,
  initialValues,
  onSaved,
  onClose,
}: {
  companyId: string
  project: Project | null
  initialValues: ProjectFormValues
  onSaved: (project: Project) => void
  onClose: () => void
}) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<ProjectFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEdit = project !== null

  function updateField<K extends keyof ProjectFormValues>(
    field: K,
    value: ProjectFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)

    const validationErrors = validateProjectForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setSaving(true)
    try {
      const result = isEdit
        ? await updateProject(companyId, project.id, values)
        : await createProject(companyId, values)

      if (result.error !== null) {
        setSubmitError(result.error)
        return
      }
      onSaved(result.data)
    } catch {
      setSubmitError('Something went wrong. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Project' : 'Add Project'}
      titleId="project-form-title"
      onClose={onClose}
      dismissable={!saving}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4 p-6">
          {submitError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {submitError}
            </div>
          )}

          <FormField
            id="projectName"
            label="Project Name"
            required
            error={errors.projectName}
          >
            <input
              id="projectName"
              autoComplete="off"
              value={values.projectName}
              onChange={(e) => updateField('projectName', e.target.value)}
              disabled={saving}
              placeholder="e.g. Sandton Office Development"
              aria-invalid={errors.projectName ? true : undefined}
              aria-describedby={errors.projectName ? 'projectName-error' : undefined}
              className={inputClasses(Boolean(errors.projectName))}
            />
          </FormField>

          <FormField id="clientName" label="Client Name" error={errors.clientName}>
            <input
              id="clientName"
              autoComplete="off"
              value={values.clientName}
              onChange={(e) => updateField('clientName', e.target.value)}
              disabled={saving}
              placeholder="e.g. ABC Construction"
              aria-invalid={errors.clientName ? true : undefined}
              aria-describedby={errors.clientName ? 'clientName-error' : undefined}
              className={inputClasses(Boolean(errors.clientName))}
            />
          </FormField>

          <FormField id="address" label="Address" error={errors.address}>
            <textarea
              id="address"
              rows={2}
              value={values.address}
              onChange={(e) => updateField('address', e.target.value)}
              disabled={saving}
              placeholder="Site address"
              aria-invalid={errors.address ? true : undefined}
              aria-describedby={errors.address ? 'address-error' : undefined}
              className={inputClasses(Boolean(errors.address))}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="startDate" label="Start Date" error={errors.startDate}>
              <input
                id="startDate"
                type="date"
                value={values.startDate}
                onChange={(e) => {
                  updateField('startDate', e.target.value)
                  if (errors.endDate) setErrors((prev) => ({ ...prev, endDate: undefined }))
                }}
                disabled={saving}
                className={inputClasses(Boolean(errors.startDate))}
              />
            </FormField>

            <FormField id="endDate" label="End Date" error={errors.endDate}>
              <input
                id="endDate"
                type="date"
                value={values.endDate}
                onChange={(e) => updateField('endDate', e.target.value)}
                disabled={saving}
                aria-invalid={errors.endDate ? true : undefined}
                aria-describedby={errors.endDate ? 'endDate-error' : undefined}
                className={inputClasses(Boolean(errors.endDate))}
              />
            </FormField>
          </div>

          <FormField id="status" label="Status" error={errors.status}>
            <select
              id="status"
              value={values.status}
              onChange={(e) => updateField('status', e.target.value as ProjectStatus)}
              disabled={saving}
              className={inputClasses(Boolean(errors.status))}
            >
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {projectStatusLabels[status]}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function DeleteProjectModal({
  project,
  onConfirm,
  onClose,
}: {
  project: Project
  onConfirm: () => Promise<string | null>
  onClose: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setError(null)
    setDeleting(true)
    try {
      const result = await onConfirm()
      if (result) setError(result)
    } catch {
      setError('Something went wrong. Please check your connection and try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      title="Delete project?"
      titleId="delete-project-title"
      onClose={onClose}
      dismissable={!deleting}
    >
      <div className="space-y-4 p-6 text-sm">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700"
          >
            {error}
          </div>
        )}
        <p className="text-slate-600">
          Are you sure you want to permanently delete{' '}
          <span className="font-medium text-slate-900">{project.project_name}</span>?
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          Worker assignments and any checklist records linked to this project
          may also be removed. Your workers and their documents are{' '}
          <strong>not</strong> deleted; they stay in your company. This cannot
          be undone. Consider setting the status to Archived instead.
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={deleting}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={deleting}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? 'Deleting…' : 'Delete Project'}
        </button>
      </div>
    </Modal>
  )
}
