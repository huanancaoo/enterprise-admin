"use client"

import { useId } from "react"
import { useI18n } from "fumadocs-ui/contexts/i18n"
import { createOpenAPIPage } from "fumadocs-openapi/ui"
import PlaygroundClient, { Custom } from "fumadocs-openapi/ui/playground/client"
import {
  binaryCodeUsages,
  imageMediaAdapters,
  imagePlaygroundFetchOptions,
} from "@/lib/openapi-media-adapters"

function PersonalMediaFileField() {
  const id = useId()
  const { locale } = useI18n()
  const { setValue } = Custom.useController(["body"])
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {locale === "zh-CN" ? "图片文件" : "Image file"}
      </label>
      <input
        id={id}
        type="file"
        required
        accept={Object.keys(imageMediaAdapters).join(",")}
        onChange={(event) => {
          const input = event.currentTarget
          const file = input.files?.item(0) ?? null
          input.setCustomValidity(
            file && !Object.hasOwn(imageMediaAdapters, file.type)
              ? locale === "zh-CN"
                ? "请选择具有正确媒体类型的 JPEG、PNG、WebP 或 GIF 图片"
                : "Choose a JPEG, PNG, WebP or GIF file with its image media type"
              : ""
          )
          setValue(file)
        }}
      />
    </div>
  )
}

export const OpenAPIPage = createOpenAPIPage({
  mediaAdapters: imageMediaAdapters,
  codeUsages: binaryCodeUsages,
  playground: {
    render({ operation }) {
      // Raw image bodies become schema {} during OpenAPI upgrade; the same Playground controller holds their File.
      return (
        <PlaygroundClient
          writeOnly
          readOnly={false}
          fetchOptions={imagePlaygroundFetchOptions}
          renderBodyField={
            operation.operationId === "uploadPersonalMedia"
              ? () => <PersonalMediaFileField />
              : undefined
          }
        />
      )
    },
  },
})
