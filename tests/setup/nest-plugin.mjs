import swc from "unplugin-swc"

// Nest 构造函数注入依赖 design:paramtypes；测试转译必须保留与 tsc 相同的装饰器元数据。
export function nestPlugin() {
  return swc.vite({
    jsc: {
      target: "es2023",
      parser: { syntax: "typescript", decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
    },
    module: { type: "es6" },
  })
}
