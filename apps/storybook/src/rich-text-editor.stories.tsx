import { useRef, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import {
  RichTextEditor,
  type JSONContent,
  type RichTextEditorProps,
} from "@workspace/admin"
import { DirectionProvider } from "@workspace/ui/components/direction"
import { Button } from "@workspace/ui/components/button"

const reference = {
  fileId: "11111111-1111-4111-8111-111111111111",
  versionId: "22222222-2222-4222-8222-222222222222",
}
const sample: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", marks: [{ type: "bold" }], text: "world" },
        { type: "text", text: "." },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Item one" }],
            },
          ],
        },
      ],
    },
  ],
}
const sampleWithImage: JSONContent = {
  type: "doc",
  content: [
    ...sample.content!,
    { type: "fileImage", attrs: { ...reference, alt: "Example" } },
  ],
}
function imageBlob() {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII="
    ),
    (character) => character.charCodeAt(0)
  )
  return new Blob([bytes], { type: "image/png" })
}
function imageFile() {
  return new File([imageBlob()], "example.png", { type: "image/png" })
}

type EditableProps = Extract<RichTextEditorProps, { editable?: true }>
type UploadImage = NonNullable<EditableProps["onUploadImage"]>
function EditorExample({
  variant,
  editable = true,
  initialValue = sample,
  failUpload = false,
  failRead = false,
  noUpload = false,
}: {
  variant: "field" | "document"
  editable?: boolean
  initialValue?: JSONContent
  failUpload?: boolean | "once"
  failRead?: boolean
  noUpload?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  const attempts = useRef(0)
  const upload: UploadImage = async (_file, options) => {
    options.onStage("transmitting")
    options.onStage("saving")
    options.onStage("confirming")
    attempts.current += 1
    if (
      failUpload === true ||
      (failUpload === "once" && attempts.current === 1)
    )
      throw new Error("Insufficient storage")
    return reference
  }
  const ports = {
    contentScopeKey: "user:organization:revision-1",
    resolveImage: async () => {
      if (failRead) throw new Error("File permission was revoked")
      return imageBlob()
    },
    downloadFile: async () => {
      throw new Error("File permission was revoked")
    },
    getFileErrorMessage: (error: unknown) => (error as Error).message,
  }
  return (
    <>
      {editable ? (
        <RichTextEditor
          variant={variant}
          value={value}
          onChange={setValue}
          onUploadImage={noUpload ? undefined : upload}
          {...ports}
        />
      ) : (
        <RichTextEditor
          variant={variant}
          value={value}
          editable={false}
          {...ports}
        />
      )}
      <output aria-label="Document JSON">{JSON.stringify(value)}</output>
    </>
  )
}
const meta = {
  globals: { locale: "en-US" },
  title: "Admin/RichTextEditor",
  component: EditorExample,
  parameters: { a11y: { test: "error" } },
  args: { variant: "document" },
} satisfies Meta<typeof EditorExample>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("button", { name: "Bold" })).toBeVisible()
    await expect(canvas.getByText("Title")).toBeVisible()
    await expect(
      canvasElement.querySelector('[data-slot="rich-text-editor"]')
    ).toHaveAttribute("data-variant", "document")
  },
}
export const Field: Story = {
  args: { variant: "field" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Bold" })
    ).toBeVisible()
    await expect(
      canvasElement.querySelector('[data-slot="rich-text-editor"]')
    ).toHaveAttribute("data-variant", "field")
  },
}
export const ReadOnly: Story = {
  args: { editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole("button", { name: "Bold" })
    ).not.toBeInTheDocument()
    await expect(canvas.getByText("Title")).toBeVisible()
    await expect(canvas.getByText("world")).toBeVisible()
  },
}
export const Rtl: Story = {
  globals: { locale: "ar" },
  render: () => (
    <DirectionProvider direction="rtl">
      <div dir="rtl">
        <EditorExample variant="document" />
      </div>
    </DirectionProvider>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[dir='rtl']")).not.toBeNull()
    await expect(within(canvasElement).getByText("Title")).toBeVisible()
  },
}
export const ImageUpload: Story = {
  play: async ({ canvasElement }) => {
    const input =
      canvasElement.querySelector<HTMLInputElement>("input[type=file]")!
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Image" }))
    await userEvent.upload(input, imageFile())
    await expect(
      canvas.findByRole("img", { name: "example.png" })
    ).resolves.toBeVisible()
    const json = canvas.getByLabelText("Document JSON").textContent!
    await expect(json).toContain('"type":"fileImage"')
    await expect(json).toContain(reference.versionId)
    await expect(json).not.toContain('"src"')
    await expect(json).not.toContain("blob:")
    await expect(json).not.toContain('"href"')
  },
}
export const UploadFailureKeepsDraft: Story = {
  args: { failUpload: true },
  play: async ({ canvasElement }) => {
    await userEvent.upload(
      canvasElement.querySelector<HTMLInputElement>("input[type=file]")!,
      imageFile()
    )
    const canvas = within(canvasElement)
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent(
      "Insufficient storage"
    )
    await expect(canvas.getByText("Title")).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Submit again" })
    ).toBeVisible()
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
    await expect(canvas.getByLabelText("Document JSON")).toHaveTextContent(
      "Hello"
    )
  },
}
export const PasteFailureKeepsDraft: Story = {
  args: { failUpload: true },
  play: async ({ canvasElement }) => {
    const editor = canvasElement.querySelector<HTMLElement>(".tiptap")!
    editor.focus()
    const data = new DataTransfer()
    data.items.add(imageFile())
    editor.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })
    )
    const canvas = within(canvasElement)
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent(
      "Insufficient storage"
    )
    await expect(canvas.getByText("Title")).toBeVisible()
  },
}
export const DropFailureKeepsDraft: Story = {
  args: { failUpload: true },
  play: async ({ canvasElement }) => {
    const editor = canvasElement.querySelector<HTMLElement>(".tiptap")!
    const rect = editor.getBoundingClientRect()
    const data = new DataTransfer()
    data.items.add(imageFile())
    editor.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: rect.x + 20,
        clientY: rect.y + 20,
      })
    )
    const canvas = within(canvasElement)
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent(
      "Insufficient storage"
    )
    await expect(canvas.getByText("Title")).toBeVisible()
  },
}
export const NoUploadCapability: Story = {
  args: { noUpload: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("button", { name: "Bold" })).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Image" })
    ).not.toBeInTheDocument()
    await expect(canvasElement.querySelector("input[type=file]")).toBeNull()
  },
}
export const ReadFailure: Story = {
  args: { initialValue: sampleWithImage, failRead: true, editable: false },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).findByRole("alert")
    ).resolves.toHaveTextContent("File permission was revoked")
  },
}
export const AttachmentReadFailure: Story = {
  args: {
    editable: false,
    initialValue: {
      type: "doc",
      content: [
        {
          type: "fileAttachment",
          attrs: { ...reference, label: "contract.pdf" },
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole("button", { name: "Download contract.pdf" })
    )
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent(
      "File permission was revoked"
    )
    await expect(
      canvas.getByLabelText("Document JSON").textContent
    ).not.toContain('"href"')
  },
}

function ScopeExample() {
  const [scope, setScope] = useState("revision-1")
  const [visible, setVisible] = useState(true)
  const [aborted, setAborted] = useState(false)
  return (
    <>
      <Button onClick={() => setScope("revision-2")}>Change access</Button>
      <Button onClick={() => setVisible(false)}>Hide editor</Button>
      <output aria-label="Read aborted">{String(aborted)}</output>
      {visible && (
        <RichTextEditor
          variant="document"
          editable={false}
          value={sampleWithImage}
          contentScopeKey={scope}
          getFileErrorMessage={(error) => (error as Error).message}
          downloadFile={async () => {}}
          resolveImage={async (_ref, signal) => {
            signal.addEventListener("abort", () => setAborted(true), {
              once: true,
            })
            if (scope === "revision-2")
              throw new Error("File permission was revoked")
            return imageBlob()
          }}
        />
      )}
    </>
  )
}
export const AccessChangeReleasesImage: Story = {
  render: () => <ScopeExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const image = await canvas.findByRole("img", { name: "Example" })
    const oldUrl = image.getAttribute("src")!
    await expect(await fetch(oldUrl).then((response) => response.ok)).toBe(true)
    await userEvent.click(canvas.getByRole("button", { name: "Change access" }))
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent(
      "File permission was revoked"
    )
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
    await expect(canvas.getByLabelText("Read aborted")).toHaveTextContent(
      "true"
    )
    await expect(
      await fetch(oldUrl).then(
        () => true,
        () => false
      )
    ).toBe(false)
  },
}
export const UnmountReleasesImage: Story = {
  render: () => <ScopeExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const image = await canvas.findByRole("img", { name: "Example" })
    const oldUrl = image.getAttribute("src")!
    await userEvent.click(canvas.getByRole("button", { name: "Hide editor" }))
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
    await expect(canvas.getByLabelText("Read aborted")).toHaveTextContent(
      "true"
    )
    await expect(
      await fetch(oldUrl).then(
        () => true,
        () => false
      )
    ).toBe(false)
  },
}

export const RetryKeepsSelectedFile: Story = {
  args: { failUpload: "once" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.upload(
      canvasElement.querySelector<HTMLInputElement>("input[type=file]")!,
      imageFile()
    )
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent(
      "Insufficient storage"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Submit again" }))
    await expect(
      canvas.findByRole("img", { name: "example.png" })
    ).resolves.toBeVisible()
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument()
    await expect(canvas.getByLabelText("Document JSON")).toHaveTextContent(
      "Hello"
    )
  },
}
export const ChineseUploadFailure: Story = {
  globals: { locale: "zh-CN" },
  args: { failUpload: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.upload(
      canvasElement.querySelector<HTMLInputElement>("input[type=file]")!,
      imageFile()
    )
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent(
      "上传失败"
    )
    await expect(canvas.getByRole("button", { name: "重新提交" })).toBeVisible()
  },
}
function ProgressExample() {
  const [value, setValue] = useState(sample)
  const [waiting, setWaiting] = useState(false)
  const [aborted, setAborted] = useState(false)
  const continueUpload = useRef<(() => void) | null>(null)
  const upload: UploadImage = async (_file, options) => {
    for (const stage of ["transmitting", "saving", "confirming"] as const) {
      options.onStage(stage)
      setWaiting(true)
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          setAborted(true)
          reject(new DOMException("Read stopped", "AbortError"))
        }
        options.signal.addEventListener("abort", abort, { once: true })
        continueUpload.current = () => {
          options.signal.removeEventListener("abort", abort)
          setWaiting(false)
          resolve()
        }
      })
    }
    return reference
  }
  return (
    <>
      <Button disabled={!waiting} onClick={() => continueUpload.current!()}>
        Continue
      </Button>
      <output aria-label="Upload aborted">{String(aborted)}</output>
      <RichTextEditor
        variant="document"
        value={value}
        onChange={setValue}
        contentScopeKey="user:organization:revision-1"
        onUploadImage={upload}
        resolveImage={async () => imageBlob()}
        downloadFile={async () => {}}
        getFileErrorMessage={(error) => (error as Error).message}
      />
    </>
  )
}
export const ActualUploadStages: Story = {
  render: () => <ProgressExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.upload(
      canvasElement.querySelector<HTMLInputElement>("input[type=file]")!,
      imageFile()
    )
    for (const label of [
      "Transferring example.png",
      "Saving example.png",
      "Confirming example.png",
    ]) {
      await expect(canvas.findByText(label)).resolves.toBeVisible()
      await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
      await userEvent.click(canvas.getByRole("button", { name: "Continue" }))
    }
    await expect(
      canvas.findByRole("img", { name: "example.png" })
    ).resolves.toBeVisible()
    await expect(canvas.getByText("example.png saved")).toBeVisible()
  },
}
export const StopWaitingDoesNotResubmit: Story = {
  render: () => <ProgressExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.upload(
      canvasElement.querySelector<HTMLInputElement>("input[type=file]")!,
      imageFile()
    )
    await expect(
      canvas.findByText("Transferring example.png")
    ).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Stop waiting" }))
    await expect(canvas.getByLabelText("Upload aborted")).toHaveTextContent(
      "true"
    )
    await expect(
      canvas.getByText(/Confirm the result in the file library/)
    ).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Submit again" })
    ).not.toBeInTheDocument()
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
    await expect(canvas.getByText("Title")).toBeVisible()
  },
}
