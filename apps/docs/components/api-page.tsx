"use client"

import { createOpenAPIPage } from "fumadocs-openapi/ui"
import {
  binaryCodeUsages,
  imageMediaAdapters,
} from "@/lib/openapi-media-adapters"

export const OpenAPIPage = createOpenAPIPage({
  mediaAdapters: imageMediaAdapters,
  codeUsages: binaryCodeUsages,
})
