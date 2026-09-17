import { defineConfig } from "orval"

export default defineConfig({
  api: {
    input: {
      // 生成客户端只读导出快照，避免和运行中的 /api/docs-json 各用一套规范。
      target: "./apps/api/openapi/openapi.json",
    },
    output: {
      mode: "tags-split",
      target: "./packages/api-client/src/generated/endpoints/index.ts",
      schemas: "./packages/api-client/src/generated/models",
      client: "react-query",
      httpClient: "fetch",
      headers: true,
      formatter: "prettier",
      clean: true,
      packageJson: "./packages/api-client/package.json",
      override: {
        operations: {
          getOrganizationAccess: {
            query: {
              queryKey: {
                path: "./packages/api-client/src/query/organizations.ts",
                name: "organizationAccessKey",
              },
            },
          },
          listProjects: {
            query: {
              queryOptions: {
                path: "./packages/api-client/src/query/projects.ts",
                name: "projectListOptions",
                useHooks: false,
              },
              queryKey: {
                path: "./packages/api-client/src/query/projects.ts",
                name: "listProjectsKey",
              },
            },
          },
          getProject: {
            query: {
              queryKey: {
                path: "./packages/api-client/src/query/projects.ts",
                name: "getProjectKey",
              },
            },
          },
        },
        query: {
          version: 5,
        },
        fetch: {
          includeHttpResponseReturnType: true,
          forceSuccessResponse: true,
        },
        mutator: {
          path: "./packages/api-client/src/http/client.ts",
          name: "apiClient",
        },
      },
    },
  },
})
