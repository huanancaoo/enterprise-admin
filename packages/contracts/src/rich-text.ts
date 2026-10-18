import { z } from "zod"

export function createRichTextMarkSchema(safeLink: z.ZodType<string>) {
  return z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("bold") }),
    z.strictObject({ type: z.literal("italic") }),
    z.strictObject({ type: z.literal("strike") }),
    z.strictObject({ type: z.literal("code") }),
    z.strictObject({
      type: z.literal("link"),
      attrs: z.strictObject({
        href: safeLink,
        target: z
          .enum(["_blank", "_self", "_parent", "_top"])
          .nullable()
          .optional(),
        rel: z.string().nullable().optional(),
        class: z.string().nullable().optional(),
      }),
    }),
  ])
}

// 只共用 JSON 节点形状；链接过滤和文件版本归属仍由各业务契约决定。
export function createRichTextNodeVariants<TNode, TMark>(
  children: z.ZodType<TNode[]>,
  mark: z.ZodType<TMark>
) {
  return [
    z.strictObject({
      type: z.literal("text"),
      text: z.string().min(1),
      marks: z.array(mark).optional(),
    }),
    z.strictObject({
      type: z.literal("hardBreak"),
      marks: z.array(mark).optional(),
    }),
    z.strictObject({
      type: z.literal("paragraph"),
      content: children.optional(),
    }),
    z.strictObject({
      type: z.literal("heading"),
      attrs: z.strictObject({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      }),
      content: children.optional(),
    }),
    z.strictObject({ type: z.literal("blockquote"), content: children }),
    z.strictObject({ type: z.literal("bulletList"), content: children }),
    z.strictObject({
      type: z.literal("orderedList"),
      attrs: z
        .strictObject({
          start: z.number().int().min(1),
          type: z.enum(["1", "a", "A", "i", "I"]).nullable().optional(),
        })
        .optional(),
      content: children,
    }),
    z.strictObject({ type: z.literal("listItem"), content: children }),
    z.strictObject({
      type: z.literal("codeBlock"),
      attrs: z.strictObject({ language: z.string().nullable() }).optional(),
      content: children.optional(),
    }),
    z.strictObject({ type: z.literal("table"), content: children }),
    z.strictObject({ type: z.literal("tableRow"), content: children }),
    ...(["tableCell", "tableHeader"] as const).map((type) =>
      z.strictObject({
        type: z.literal(type),
        attrs: z.strictObject({
          colspan: z.number().int().min(1),
          rowspan: z.number().int().min(1),
          colwidth: z.array(z.number().int().positive()).nullable(),
          align: z.enum(["left", "center", "right"]).nullable().optional(),
        }),
        content: children,
      })
    ),
  ] as const
}
