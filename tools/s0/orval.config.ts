import { defineConfig } from "orval"

export default defineConfig({
  probe: {
    input: "./.artifacts/openapi.json",
    output: {
      target: "./generated/client.ts",
      client: "react-query",
      httpClient: "fetch",
      override: { query: { version: 5 } },
    },
  },
})
