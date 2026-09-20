import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"
import { Accordion, Accordions } from "fumadocs-ui/components/accordion"
import { GitHubReleases } from "@/components/github-releases"
import { Mermaid } from "@/components/mermaid"

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    GitHubReleases,
    Mermaid,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
