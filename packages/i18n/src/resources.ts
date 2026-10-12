import webhooks2 from "./locales/ar/webhooks.json" with { type: "json" }
import webhooks1 from "./locales/en-US/webhooks.json" with { type: "json" }
import webhooks0 from "./locales/zh-CN/webhooks.json" with { type: "json" }
import tasks2 from "./locales/ar/tasks.json" with { type: "json" }
import tasks1 from "./locales/en-US/tasks.json" with { type: "json" }
import tasks0 from "./locales/zh-CN/tasks.json" with { type: "json" }
import credentials2 from "./locales/ar/credentials.json" with { type: "json" }
import credentials1 from "./locales/en-US/credentials.json" with { type: "json" }
import credentials0 from "./locales/zh-CN/credentials.json" with { type: "json" }
import notifications2 from "./locales/ar/notifications.json" with { type: "json" }
import notifications1 from "./locales/en-US/notifications.json" with { type: "json" }
import notifications0 from "./locales/zh-CN/notifications.json" with { type: "json" }
import common0 from "./locales/zh-CN/common.json" with { type: "json" }
import files0 from "./locales/zh-CN/files.json" with { type: "json" }
import auth0 from "./locales/zh-CN/auth.json" with { type: "json" }
import organization0 from "./locales/zh-CN/organization.json" with { type: "json" }
import projects0 from "./locales/zh-CN/projects.json" with { type: "json" }
import validation0 from "./locales/zh-CN/validation.json" with { type: "json" }
import errors0 from "./locales/zh-CN/errors.json" with { type: "json" }
import settings0 from "./locales/zh-CN/settings.json" with { type: "json" }
import common1 from "./locales/en-US/common.json" with { type: "json" }
import files1 from "./locales/en-US/files.json" with { type: "json" }
import auth1 from "./locales/en-US/auth.json" with { type: "json" }
import organization1 from "./locales/en-US/organization.json" with { type: "json" }
import projects1 from "./locales/en-US/projects.json" with { type: "json" }
import validation1 from "./locales/en-US/validation.json" with { type: "json" }
import errors1 from "./locales/en-US/errors.json" with { type: "json" }
import settings1 from "./locales/en-US/settings.json" with { type: "json" }
import common2 from "./locales/ar/common.json" with { type: "json" }
import files2 from "./locales/ar/files.json" with { type: "json" }
import auth2 from "./locales/ar/auth.json" with { type: "json" }
import organization2 from "./locales/ar/organization.json" with { type: "json" }
import projects2 from "./locales/ar/projects.json" with { type: "json" }
import validation2 from "./locales/ar/validation.json" with { type: "json" }
import errors2 from "./locales/ar/errors.json" with { type: "json" }
import settings2 from "./locales/ar/settings.json" with { type: "json" }

export const resources = {
  "zh-CN": {
    common: common0,
    files: files0,
    auth: auth0,
    organization: organization0,
    projects: projects0,
    validation: validation0,
    errors: errors0,
    settings: settings0,
    notifications: notifications0,
    tasks: tasks0,
    webhooks: webhooks0,
    credentials: credentials0,
  },
  "en-US": {
    common: common1,
    files: files1,
    auth: auth1,
    organization: organization1,
    projects: projects1,
    validation: validation1,
    errors: errors1,
    settings: settings1,
    notifications: notifications1,
    tasks: tasks1,
    webhooks: webhooks1,
    credentials: credentials1,
  },
  ar: {
    common: common2,
    files: files2,
    auth: auth2,
    organization: organization2,
    projects: projects2,
    validation: validation2,
    errors: errors2,
    settings: settings2,
    notifications: notifications2,
    tasks: tasks2,
    webhooks: webhooks2,
    credentials: credentials2,
  },
}
