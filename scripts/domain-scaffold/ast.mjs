import ts from "typescript"

export function source(file, text) {
  const result = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  if (result.parseDiagnostics.length)
    throw new Error(`${file}: existing TypeScript cannot be parsed`)
  return result
}
export function descendants(node, predicate) {
  const found = []
  function visit(item) {
    if (predicate(item)) found.push(item)
    ts.forEachChild(item, visit)
  }
  visit(node)
  return found
}
export function one(items, label) {
  if (items.length !== 1)
    throw new Error(
      `${label}: expected one registration point, found ${items.length}`
    )
  return items[0]
}
export function initializer(ast, name) {
  return one(
    descendants(
      ast,
      (node) =>
        ts.isVariableDeclaration(node) && node.name.getText(ast) === name
    ),
    name
  ).initializer
}
export function unwrap(node) {
  while (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression
  return node
}
export function property(object, name, ast) {
  return one(
    unwrap(object).properties.filter(
      (node) =>
        node.name &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        node.name.text === name
    ),
    name
  )
}
export function append(node, value) {
  node = unwrap(node)
  if (
    !ts.isArrayLiteralExpression(node) &&
    !ts.isObjectLiteralExpression(node) &&
    !ts.isTypeLiteralNode(node)
  )
    throw new Error("registration is not a literal")
  const items = node.properties ?? node.elements ?? node.members
  const end = node.end - 1
  const separator = ts.isTypeLiteralNode(node)
    ? "\n"
    : items.length && !items.hasTrailingComma
      ? ",\n"
      : "\n"
  return { start: end, end, value: `${separator}${value}\n` }
}
export function apply(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  for (let index = 0; index < sorted.length; index++) {
    const edit = sorted[index]
    if (index > 0 && edit.end > sorted[index - 1].start)
      throw new Error("overlapping registration edits")
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end)
  }
  return text
}
export { ts }
