import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { LoginLog } from "@workspace/contracts/identity-management"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import {
  DataTableColumnHeader,
  createDataTableColumnHelper,
} from "../data-table"

const reasonLabels = {
  INVALID_CREDENTIALS: "reasonInvalidCredentials",
  PASSWORD_LOGIN_LOCKED: "reasonPasswordLoginLocked",
  EMAIL_NOT_VERIFIED: "reasonEmailNotVerified",
  INVALID_OTP: "reasonInvalidOtp",
  ACCOUNT_SUSPENDED: "reasonAccountSuspended",
  AUTHORIZATION_UNAVAILABLE: "reasonAuthorizationUnavailable",
  AUTHENTICATION_FAILED: "reasonAuthenticationFailed",
} as const

export function useLoginEventColumns<TLog extends LoginLog>() {
  const { t } = useTranslation(["identity", "common", "organization"])
  const locale = useUiLocale()
  return useMemo(() => {
    const columns = createDataTableColumnHelper<TLog>()
    const format = createFormatter(locale)
    // 保留静态键，确保翻译提取器能识别全部登录方式和结果文案。
    const methodLabels = {
      email: String(t("emailMethod")),
      github: String(t("githubMethod")),
      totp: String(t("totpMethod")),
    } satisfies Record<LoginLog["method"], string>
    const resultLabels = {
      succeeded: String(t("succeeded")),
      failed: String(t("failed")),
    } satisfies Record<LoginLog["result"], string>
    return {
      occurredAt: columns.accessor((row) => row.occurredAt, {
        id: "occurredAt",
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("occurredAt")} />
        ),
        cell: ({ getValue }) =>
          format.dateTime(new Date(getValue()), "UTC", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        meta: { label: t("occurredAt") },
        size: 210,
      }),
      method: columns.accessor((row) => row.method, {
        id: "method",
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("method")} />
        ),
        cell: ({ getValue }) => methodLabels[getValue()],
        meta: {
          label: t("method"),
          facetMode: "single",
          facetOptions: (["email", "github", "totp"] as const).map((value) => ({
            value,
            label: methodLabels[value],
          })),
        },
      }),
      result: columns.accessor((row) => row.result, {
        id: "result",
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("result")} />
        ),
        cell: ({ getValue }) => (
          <Badge variant={getValue() === "succeeded" ? "secondary" : "outline"}>
            {resultLabels[getValue()]}
          </Badge>
        ),
        meta: {
          label: t("result"),
          facetMode: "single",
          facetOptions: (["succeeded", "failed"] as const).map((value) => ({
            value,
            label: resultLabels[value],
          })),
        },
      }),
      reasonCode: columns.accessor((row) => row.reasonCode, {
        id: "reasonCode",
        header: t("reason"),
        cell: ({ getValue }) => {
          const reason = getValue()
          return reason ? t(`identity:${reasonLabels[reason]}`) : "—"
        },
        meta: { label: t("reason") },
      }),
      ipAddress: columns.accessor((row) => row.ipAddress, {
        id: "ipAddress",
        header: t("ipAddress"),
        cell: ({ getValue }) => (
          <bdi className="font-mono text-xs">{getValue() ?? "—"}</bdi>
        ),
        meta: { label: t("ipAddress") },
        size: 160,
      }),
      userAgent: columns.accessor((row) => row.userAgent, {
        id: "userAgent",
        header: t("userAgent"),
        cell: ({ getValue }) => (
          <span className="line-clamp-2">{getValue() ?? "—"}</span>
        ),
        meta: { label: t("userAgent") },
        size: 300,
      }),
    }
  }, [locale, t])
}
