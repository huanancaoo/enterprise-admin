import { createReactConfig } from "@workspace/eslint-config/react-internal"

export default [
  ...createReactConfig(import.meta.dirname),
  {
    // 暂时保留已核实的 shadcn 上游混合导出，仅排除这些文件的热更新边界检查。
    files: [
      "src/components/badge.tsx",
      "src/components/button-group.tsx",
      "src/components/button.tsx",
      "src/components/carousel.tsx",
      "src/components/combobox.tsx",
      "src/components/direction.tsx",
      "src/components/marker.tsx",
      "src/components/message-scroller.tsx",
      "src/components/navigation-menu.tsx",
      "src/components/sidebar.tsx",
      "src/components/tabs.tsx",
      "src/components/toast.tsx",
      "src/components/toggle.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // 这两处初始化外部状态的 effect 与 shadcn 上游一致，暂不改写组件实现。
    files: ["src/components/carousel.tsx", "src/hooks/use-mobile.ts"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]
