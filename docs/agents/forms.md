# 表单规范

本项目的 React 表单使用 TanStack Form 管理状态、Zod 定义客户端 Schema，并使用 shadcn/ui 的 `Field` 组件组织结构。实现方式以 [shadcn/ui TanStack Form 指南](https://ui.shadcn.com/docs/forms/tanstack-form) 为基线。

## 实现流程

1. 在表单所属包声明 `@tanstack/react-form` 与 `zod` 直接依赖。
2. 在组件外定义 Zod Schema，在 `useForm` 的 `validators.onSubmit` 中接入；业务需要提前反馈时，显式选择 `onBlur` 或 `onChange`，不要同时复制同一套手写校验。
3. `defaultValues` 覆盖 Schema 的全部字段。提交逻辑只接收校验通过的 `value`，服务端仍执行完整输入校验。
4. 每个控件使用 `form.Field` 的 render prop，并由 `Field` 包裹 `FieldLabel`、控件、可选的 `FieldDescription` 和 `FieldError`；多个字段放在 `FieldGroup` 中。
5. 字段失效条件统一为 `field.state.meta.isTouched && !field.state.meta.isValid`。将该值传给 `Field` 的 `data-invalid` 和控件的 `aria-invalid`，并在失效时渲染 `<FieldError errors={field.state.meta.errors} />`。
6. 原生 `<form>` 拦截提交事件后调用 `form.handleSubmit()`。保留与字段语义一致的 `type`、`required`、`minLength`、`maxLength` 和 `autoComplete`，让浏览器提供基础约束。
7. 请求期间禁用可提交区域并设置 `aria-busy`。字段错误由 TanStack Form 展示；服务端错误在表单操作区使用 `role="alert"` 展示。

## 组件映射

- 文本输入和 Textarea：`value` 读取 `field.state.value`，`onChange` 调用 `field.handleChange`，`onBlur` 调用 `field.handleBlur`。
- Select：`value` 与 `onValueChange` 连接字段，`aria-invalid` 放在 `SelectTrigger`。
- Checkbox：`checked` 与 `onCheckedChange` 连接字段；数组字段使用 `mode="array"` 和字段数组方法，复选框组使用 `FieldGroup data-slot="checkbox-group"`。
- Radio Group：值连接 `RadioGroup`，每个 `RadioGroupItem` 标记 `aria-invalid`。

## 验证

运行所属应用或包的 lint 与 typecheck，并覆盖以下交互：无效提交显示字段错误；修正输入后可以提交；请求期间不能重复提交；服务端错误不会清空用户输入。关键认证或租户流程同时运行对应浏览器测试。
