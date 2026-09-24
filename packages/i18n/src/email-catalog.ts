import type { EmailLocale } from "./locale.js"

export type EmailTemplateKey =
  "verify-email" | "password-reset" | "organization.invitation"

export type EmailCopy = {
  subject: string
  greeting: (name: string) => string
  body: string
  action: string
  ignore: string
}

// 邮件在入队时渲染并冻住；这里没有 ar，因为邮件允许集不含 ar。
export const emailCatalog: Record<
  EmailTemplateKey,
  Record<EmailLocale, EmailCopy>
> = {
  "verify-email": {
    "zh-CN": {
      subject: "验证你的邮箱",
      greeting: (name) => `你好，${name}`,
      body: "请点击下面的链接验证邮箱。链接只能使用一次。",
      action: "验证邮箱",
      ignore: "如果不是你本人操作，请忽略这封邮件。",
    },
    "en-US": {
      subject: "Verify your email",
      greeting: (name) => `Hi ${name}`,
      body: "Click the link below to verify your email. The link can be used once.",
      action: "Verify email",
      ignore: "If you did not request this, ignore this email.",
    },
  },
  "password-reset": {
    "zh-CN": {
      subject: "重置你的密码",
      greeting: (name) => `你好，${name}`,
      body: "请点击下面的链接设置新密码。链接在一小时内有效，且只能使用一次。",
      action: "重置密码",
      ignore: "如果不是你本人操作，请忽略这封邮件。",
    },
    "en-US": {
      subject: "Reset your password",
      greeting: (name) => `Hi ${name}`,
      body: "Click the link below to set a new password. The link expires in one hour and can be used once.",
      action: "Reset password",
      ignore: "If you did not request this, ignore this email.",
    },
  },
  "organization.invitation": {
    "zh-CN": {
      subject: "你收到一个组织邀请",
      greeting: (name) => name,
      body: "邀请你加入组织。",
      action: "接受邀请",
      ignore: "如果这不是写给你的，请忽略这封邮件。",
    },
    "en-US": {
      subject: "You are invited to an organization",
      greeting: (name) => name,
      body: "invited you to join an organization.",
      action: "Accept invitation",
      ignore: "If this was not meant for you, ignore this email.",
    },
  },
}
