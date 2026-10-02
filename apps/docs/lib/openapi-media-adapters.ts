import type { MediaAdapter } from "fumadocs-openapi"
import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators"
import { registerDefault } from "fumadocs-openapi/requests/generators/all"
import { curl } from "fumadocs-openapi/requests/generators/curl"
import { go } from "fumadocs-openapi/requests/generators/go"

const imageFiles = {
  "image/jpeg": "image.jpg",
  "image/png": "image.png",
  "image/webp": "image.webp",
  "image/gif": "image.gif",
} as const

function imageFile(mediaType: string | undefined): string | undefined {
  return mediaType && Object.hasOwn(imageFiles, mediaType)
    ? imageFiles[mediaType as keyof typeof imageFiles]
    : undefined
}

type LanguageContext<Language extends string> = Extract<
  Parameters<MediaAdapter["generateExample"]>[1],
  { lang: Language }
>

function imageAdapter(mediaType: string, fileName: string): MediaAdapter {
  const file = JSON.stringify(fileName)
  return {
    encode({ body }) {
      // Binary fields supply File/Blob; converting any other value would change the upload bytes.
      if (!(body instanceof Blob)) {
        throw new TypeError("Image request bodies must be a File or Blob")
      }
      return body
    },
    generateExample(_data, context) {
      switch (context.lang) {
        case "js": {
          const javascriptContext = context as LanguageContext<"js">
          javascriptContext.addImport("node:fs/promises", "readFile")
          return `const body = await readFile(${file});`
        }
        case "python":
          return `with open(${file}, "rb") as image_file:\n    body = image_file.read()`
        case "java": {
          const javaContext = context as LanguageContext<"java">
          javaContext.addImport("java.nio.file.Path")
          javaContext.addImport("java.net.http.HttpRequest.BodyPublishers")
          return `var body = BodyPublishers.ofFile(Path.of(${file}));`
        }
        case "csharp": {
          const csharpContext = context as LanguageContext<"csharp">
          csharpContext.addImport("System.IO")
          csharpContext.addImport("System.Net.Http.Headers")
          return `var body = new ByteArrayContent(await File.ReadAllBytesAsync(${file}));\nbody.Headers.ContentType = new MediaTypeHeaderValue(${JSON.stringify(mediaType)});`
        }
        case "rust":
          return `let body = include_bytes!(${file}).to_vec();`
      }
    },
  }
}

export const imageMediaAdapters: Record<string, MediaAdapter> =
  Object.fromEntries(
    Object.entries(imageFiles).map(([mediaType, fileName]) => [
      mediaType,
      imageAdapter(mediaType, fileName),
    ])
  )

export const binaryCodeUsages = registerDefault(
  createCodeUsageGeneratorRegistry()
)

// cURL does not call media adapters; retain its URL/headers/cookies and add the raw file body.
binaryCodeUsages.add("curl", {
  ...curl,
  generate(data, context) {
    const fileName = imageFile(data.bodyMediaType)
    if (!fileName) return curl.generate(data, context)
    return `${curl.generate({ ...data, body: undefined }, context)} \\\n  -H "Content-Type: ${data.bodyMediaType}" \\\n  --data-binary @${fileName}`
  },
})

// The default Go template reuses body for the response, so binary request readers need distinct names.
binaryCodeUsages.add("go", {
  ...go,
  generate(data, context) {
    const fileName = imageFile(data.bodyMediaType)
    if (!fileName) return go.generate(data, context)
    const headers = new Map(
      Object.entries(data.header).map(([key, parameter]) => [
        key,
        parameter.value,
      ])
    )
    headers.set("Content-Type", data.bodyMediaType!)
    if (Object.keys(data.cookie).length > 0) {
      headers.set(
        "Cookie",
        Object.entries(data.cookie)
          .map(([key, parameter]) => `${key}=${parameter.value}`)
          .join("; ")
      )
    }
    const headerLines = Array.from(
      headers,
      ([key, value]) =>
        `  req.Header.Set(${JSON.stringify(key)}, ${JSON.stringify(value)})`
    ).join("\n")
    return `package main

import (
  "fmt"
  "io"
  "net/http"
  "os"
)

func main() {
  requestBody, err := os.Open(${JSON.stringify(fileName)})
  if err != nil { panic(err) }
  defer requestBody.Close()

  req, err := http.NewRequest(${JSON.stringify(data.method.toUpperCase())}, ${JSON.stringify(data.url)}, requestBody)
  if err != nil { panic(err) }
${headerLines}
  response, err := http.DefaultClient.Do(req)
  if err != nil { panic(err) }
  defer response.Body.Close()
  responseBody, err := io.ReadAll(response.Body)
  if err != nil { panic(err) }

  fmt.Println(response.Status)
  fmt.Println(string(responseBody))
}`
  },
})
