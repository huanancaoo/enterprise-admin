export const applicationServices = [
  "api",
  "worker",
  "tenant",
  "platform",
  "migrator",
]

export const infrastructureServices = [
  "postgres",
  "redis",
  "mailpit",
  "otel-collector",
  "prometheus",
  "tracing",
]

export const releaseServices = [
  ...applicationServices,
  ...infrastructureServices,
]
