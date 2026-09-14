import { createReactConfig } from "@workspace/eslint-config/react-internal"

export default [
  { ignores: ["src/generated/**"] },
  ...createReactConfig(import.meta.dirname),
]
