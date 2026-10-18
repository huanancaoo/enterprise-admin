import { defineConfig } from "vitest/config"
import {
  playwright,
  PlaywrightBrowserProvider,
} from "@vitest/browser-playwright"
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

const browserProvider = playwright()

// 记录脚本加载和执行失败，保留导入错误发生时的资源路径。
const diagnosticProvider: typeof browserProvider = {
  ...browserProvider,
  providerFactory(project) {
    const provider = new PlaywrightBrowserProvider(
      project,
      browserProvider.options
    )
    const openPage = provider.openPage.bind(provider)
    provider.openPage = async (sessionId, url, options) => {
      await openPage(sessionId, url, options)
      const { page } = provider.getCommandsContext(sessionId)
      page.on("requestfailed", (request) => {
        if (request.resourceType() !== "script") return
        console.error("[storybook-script-failed]", {
          pathname: new URL(request.url()).pathname,
          error: request.failure()?.errorText,
        })
      })
      page.on("response", (response) => {
        const request = response.request()
        if (request.resourceType() !== "script" || response.status() < 400)
          return
        console.error("[storybook-script-http-error]", {
          pathname: new URL(request.url()).pathname,
          status: response.status(),
        })
      })
      page.on("pageerror", (error) => {
        console.error("[storybook-page-error]", {
          name: error.name,
          message: error.message.replace(/https?:\/\/[^\s"'<>]+/g, (url) =>
            url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "")
          ),
        })
      })
    }
    return provider
  },
}

const moduleResponses: Plugin = {
  name: "storybook-module-response-diagnostics",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname
      if (!/\.[cm]?[jt]sx?$/.test(pathname)) return next()
      response.once("finish", () => {
        if (response.statusCode < 400) return
        console.error("[storybook-module-http-error]", {
          pathname,
          status: response.statusCode,
        })
      })
      response.once("close", () => {
        if (response.writableFinished) return
        console.error("[storybook-module-aborted]", { pathname })
      })
      next()
    })
  },
}

export default defineConfig({
  plugins: [
    storybookTest({
      configDir: fileURLToPath(new URL(".storybook", import.meta.url)),
    }),
    moduleResponses,
  ],
  test: {
    browser: {
      enabled: true,
      headless: true,
      provider: diagnosticProvider,
      instances: [{ browser: "chromium" }],
    },
  },
})
