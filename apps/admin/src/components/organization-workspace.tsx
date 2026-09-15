import { authClient } from "@/lib/auth-client"
import { useForm } from "@tanstack/react-form"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuthAction } from "@workspace/admin/auth"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import * as z from "zod"

// QueryClient 由 AuthSession 按账号隔离；此 Key 仅持有当前账号的组织事实。
const workspaceQuery = queryOptions({
  queryKey: ["identity", "organization-workspace"],
  queryFn: async () => {
    const [organizations, active] = await Promise.all([
      authClient.organization.list(),
      authClient.organization.getFullOrganization(),
    ])
    if (organizations.error) throw new Error(organizations.error.message)
    if (active.error) throw new Error(active.error.message)
    return { organizations: organizations.data, active: active.data }
  },
  retry: false,
})

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "请输入组织名称。"),
  slug: z.string().trim().min(1, "请输入组织标识。"),
})

export function OrganizationWorkspace() {
  const workspace = useQuery(workspaceQuery)
  const queryClient = useQueryClient()
  const action = useAuthAction()
  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: {
      onSubmit: createOrganizationSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      if (
        await action.run(() =>
          authClient.organization.create({
            name: value.name.trim(),
            slug: value.slug.trim(),
            keepCurrentActiveOrganization: false,
          })
        )
      ) {
        formApi.reset()
        await queryClient.invalidateQueries(workspaceQuery)
      }
    },
  })

  async function selectOrganization(organizationId: string) {
    if (
      await action.run(() =>
        authClient.organization.setActive({ organizationId })
      )
    ) {
      await queryClient.invalidateQueries(workspaceQuery)
    }
  }

  if (workspace.isPending) return <p role="status">正在加载组织…</p>
  if (workspace.isError) {
    return (
      <div className="space-y-4">
        <p role="alert">{workspace.error.message}</p>
        <Button
          disabled={workspace.isFetching}
          onClick={() => void workspace.refetch()}
        >
          重试
        </Button>
      </div>
    )
  }
  const { organizations, active } = workspace.data
  const pending = action.pending || workspace.isFetching

  return (
    <div className="space-y-8">
      {/* 活跃组织只记录工作区偏好；此处不据此开放任何租户业务操作。 */}
      {active && (
        <section className="space-y-2 rounded-xl border bg-muted/30 p-5">
          <h1 className="text-xl font-semibold wrap-break-word">
            当前组织：{active.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            你可以在下方切换组织。
          </p>
        </section>
      )}
      <section className="space-y-4" aria-labelledby="organization-heading">
        <h2 id="organization-heading" className="text-xl font-semibold">
          选择组织
        </h2>
        {organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            你还没有加入任何组织。
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {organizations.map((organization) => (
              <li
                key={organization.id}
                className="flex min-w-0 items-center justify-between gap-4 rounded-xl border p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium wrap-break-word">
                    {organization.name}
                  </p>
                  <p className="text-sm break-all text-muted-foreground">
                    {organization.slug}
                  </p>
                </div>
                <Button
                  variant="outline"
                  aria-label={`选择 ${organization.name}`}
                  disabled={pending || active?.id === organization.id}
                  onClick={() => void selectOrganization(organization.id)}
                >
                  {active?.id === organization.id ? "已选择" : "选择"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
      <section
        className="max-w-md space-y-4 border-t pt-6"
        aria-labelledby="create-organization-heading"
      >
        <h2 id="create-organization-heading" className="text-xl font-semibold">
          创建组织
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          aria-busy={pending}
        >
          <fieldset disabled={pending}>
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="organization-name">
                        组织名称
                      </FieldLabel>
                      <Input
                        id="organization-name"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={isInvalid}
                        required
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="slug">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="organization-slug">
                        组织标识
                      </FieldLabel>
                      <Input
                        id="organization-slug"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={isInvalid}
                        required
                      />
                      <FieldDescription>
                        用于区分组织，必须唯一，例如 my-team。
                      </FieldDescription>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <Button type="submit">
                {action.pending ? "提交中…" : "创建组织"}
              </Button>
            </FieldGroup>
          </fieldset>
        </form>
      </section>
    </div>
  )
}
