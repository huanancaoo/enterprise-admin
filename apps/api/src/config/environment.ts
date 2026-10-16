import type { z } from 'zod';

export function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  env: NodeJS.ProcessEnv,
): z.output<Schema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    // 配置可能包含连接串和密钥；启动错误只暴露字段名，不序列化原始输入。
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path[0])),
    ];
    throw new Error(`Invalid application configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
