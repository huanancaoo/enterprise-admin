import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { RichTextEditor, type JSONContent } from "@workspace/admin"
import { DirectionProvider } from "@workspace/ui/components/direction"

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
    {
      type: "paragraph",
      content: [{ type: "text", text: "Uploaded image" }],
    },
    {
      type: "image",
      attrs: {
        src: "https://example.com/image.png",
        alt: "Example",
      },
    },
  ],
}

async function uploadImage(file: File) {
  return `https://picsum.photos/seed/${encodeURIComponent(file.name)}/640/360`
}

function EditorExample({
  variant,
  editable = true,
  initialValue = sample,
}: {
  variant: "field" | "document"
  editable?: boolean
  initialValue?: JSONContent
}) {
  const [value, setValue] = useState(initialValue)
  if (!editable) {
    return <RichTextEditor variant={variant} value={value} editable={false} />
  }
  return (
    <RichTextEditor
      variant={variant}
      value={value}
      onChange={setValue}
      onUploadImage={uploadImage}
    />
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
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("button", { name: "Bold" })).toBeVisible()
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
  render: () => (
    <DirectionProvider direction="rtl">
      <div dir="rtl">
        <EditorExample variant="document" />
      </div>
    </DirectionProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("button", { name: "Bold" })).toBeVisible()
    await expect(canvasElement.querySelector("[dir='rtl']")).not.toBeNull()
  },
}

export const ImageUpload: Story = {
  args: { initialValue: sampleWithImage },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("button", { name: "Image" })).toBeVisible()
    await expect(canvas.getByRole("img")).toBeVisible()
  },
}
