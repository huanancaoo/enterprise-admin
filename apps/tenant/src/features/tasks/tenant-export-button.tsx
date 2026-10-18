import { useRef } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  createOrganizationAuditExport,
  createOrganizationMemberExport,
} from "@workspace/api-client"
import {
  BusinessTaskSchema,
  CreateAuditExportSchema,
  CreateMemberExportSchema,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { authClient } from "@/lib/auth-client"

export function TenantExportButton({
  organizationId,
  resource,
  filters,
}: {
  organizationId: string
  resource: "audit" | "member"
  filters: Record<string, unknown> | null
}) {
  const { t } = useTranslation(["organization", "common"])
  const navigate = useNavigate()
  const request = useRef<{ signature: string; key: string } | null>(null)
  const access = useQuery({
    queryKey: ["organizations", organizationId, "export-permission", resource],
    retry: false,
    queryFn: async () => {
      const result = await authClient.organization.hasPermission({
        organizationId,
        permissions:
          resource === "audit" ? { audit: ["export"] } : { member: ["export"] },
      })
      if (result.error) throw new Error(result.error.message)
      return result.data.success
    },
  })
  const mutation = useMutation({
    mutationFn: async () => {
      if (!filters) return
      const filter = Object.fromEntries(
        Object.entries(filters).filter(
          ([key]) => key !== "page" && key !== "pageSize"
        )
      )
      const body =
        resource === "audit"
          ? CreateAuditExportSchema.parse({ format: "xlsx", filter })
          : CreateMemberExportSchema.parse({ format: "xlsx", filter })
      const signature = JSON.stringify(body)
      // 提交结果未知时保留同一幂等键，避免网络重试创建重复导出。
      if (request.current?.signature !== signature)
        request.current = { signature, key: crypto.randomUUID() }
      const headers = { "Idempotency-Key": request.current.key }
      const task = BusinessTaskSchema.parse(
        (resource === "audit"
          ? await createOrganizationAuditExport(
              organizationId,
              CreateAuditExportSchema.parse(body),
              headers
            )
          : await createOrganizationMemberExport(
              organizationId,
              CreateMemberExportSchema.parse(body),
              headers
            )
        ).data
      )
      request.current = null
      await navigate({
        to: "/app/tasks/$organizationId",
        params: { organizationId },
        search: { page: 1, pageSize: 20, source: "business", taskId: task.id },
      })
    },
  })
  if (!access.data) return null
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={mutation.isPending || !filters}
        onClick={() => mutation.mutate()}
      >
        {t("organization:exportMatching")}
      </Button>
      {mutation.isError && (
        <p role="alert" className="text-xs text-destructive">
          {mutation.error.message}
        </p>
      )}
    </div>
  )
}
