import { useTranslation } from "react-i18next"

export function usePlatformTaskMessages(): Record<string, string> {
  const { t } = useTranslation("platformTasks")
  const fields = {
    NAME: t("fieldName"),
    EMAIL: t("fieldEmail"),
    DEPARTMENTID: t("fieldDepartment"),
    POSTIDS: t("fieldPosts"),
    ROLEIDS: t("fieldRoles"),
  }
  const issues = {
    REQUIRED: t("issueRequired"),
    INVALID_TEXT: t("issueInvalidText"),
    INVALID_EMAIL: t("issueInvalidEmail"),
    INVALID_ID: t("issueInvalidId"),
    TOO_MANY_IDS: t("issueTooManyIds"),
    DUPLICATE_ID: t("issueDuplicateId"),
    DUPLICATE_EMAIL: t("issueDuplicateEmail"),
    FORMULA_NOT_ALLOWED: t("issueFormulaNotAllowed"),
  }
  return {
    ...Object.fromEntries(
      Object.entries(fields).flatMap(([field, label]) =>
        Object.entries(issues).map(([code, reason]) => [
          `${field}_${code}`,
          t("fieldIssue", { field: label, reason }),
        ])
      )
    ),
    EMPLOYEE_EXISTS: t("errorEmployeeExists"),
    ACCOUNT_NOT_VERIFIED: t("errorAccountNotVerified"),
    ACCOUNT_SUSPENDED: t("errorAccountSuspended"),
    ASSIGNMENT_INACTIVE: t("errorAssignmentInactive"),
    DEPARTMENT_NOT_FOUND: t("errorDepartmentNotFound"),
    POST_NOT_FOUND: t("errorPostNotFound"),
    ROLE_NOT_FOUND: t("errorRoleNotFound"),
    ASSIGNMENT_NOT_ALLOWED: t("errorAssignmentNotAllowed"),
    VERSION_CONFLICT: t("errorVersionConflict"),
    INVALID_ASSIGNMENT: t("errorInvalidAssignment"),
    INVALID_XLSX: t("errorInvalidXlsx"),
    WORKBOOK_TOO_LARGE: t("errorWorkbookTooLarge"),
    INVALID_WORKSHEETS: t("errorInvalidWorksheets"),
    INVALID_HEADERS: t("errorInvalidHeaders"),
    TOO_MANY_ROWS: t("errorTooManyRows"),
    INVALID_EXPORT_VALUE: t("errorInvalidExportValue"),
    EXPORT_CELL_TOO_LONG: t("errorExportCellTooLong"),
    FORBIDDEN: t("errorForbidden"),
    UNAUTHENTICATED: t("errorUnauthenticated"),
    EXECUTION_FAILED: t("errorExecutionFailed"),
    INVALID_PLATFORM_TASK: t("errorInvalidTask"),
  }
}
