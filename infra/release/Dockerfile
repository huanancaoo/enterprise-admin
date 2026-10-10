FROM node:26.8.2-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api apps/api
COPY apps/tenant apps/tenant
COPY apps/platform apps/platform
COPY apps/worker apps/worker
COPY packages packages
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm install --store-dir=/pnpm/store --frozen-lockfile --filter api... --filter tenant... --filter platform... --filter worker...
RUN pnpm -r --filter api... --filter tenant... --filter platform... --filter worker... build

FROM node:26.8.2-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS api
RUN npm install --global pnpm@12.4.1
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/jobs/package.json packages/jobs/package.json
COPY packages/permissions/package.json packages/permissions/package.json
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm install --store-dir=/pnpm/store --frozen-lockfile --prod --filter api...
COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/packages/database/dist packages/database/dist
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build /workspace/packages/i18n/dist packages/i18n/dist
COPY --from=build /workspace/packages/jobs/dist packages/jobs/dist
COPY --from=build /workspace/packages/permissions/src packages/permissions/src
ARG RELEASE_REVISION
LABEL org.opencontainers.image.revision=$RELEASE_REVISION
ENV NODE_ENV=production
USER node
WORKDIR /workspace/apps/api
CMD ["node", "dist/main.js"]

FROM api AS migrator
COPY packages/database/src /workspace/packages/database/src
COPY packages/database/migrations /workspace/packages/database/migrations
WORKDIR /workspace/packages/database
CMD ["node", "src/migrate.ts"]

FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS web
COPY infra/release/nginx.conf /etc/nginx/nginx.conf
ARG RELEASE_REVISION
LABEL org.opencontainers.image.revision=$RELEASE_REVISION
USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

FROM web AS tenant
COPY --from=build /workspace/apps/tenant/dist /usr/share/nginx/html

FROM web AS platform
COPY --from=build /workspace/apps/platform/dist /usr/share/nginx/html

FROM node:26.8.2-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS worker-build
RUN npm install --global pnpm@12.4.1
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker apps/worker
COPY packages packages
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm install --store-dir=/pnpm/store --frozen-lockfile --filter worker...
RUN pnpm -r --filter worker... build

FROM node:26.8.2-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS worker
RUN npm install --global pnpm@12.4.1
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/jobs/package.json packages/jobs/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/permissions/package.json packages/permissions/package.json
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm install --store-dir=/pnpm/store --frozen-lockfile --prod --filter worker...
COPY --from=worker-build /workspace/apps/worker/dist apps/worker/dist
COPY --from=worker-build /workspace/packages/jobs/dist packages/jobs/dist
COPY --from=worker-build /workspace/packages/database/dist packages/database/dist
COPY --from=worker-build /workspace/packages/i18n/dist packages/i18n/dist
COPY --from=worker-build /workspace/packages/permissions/src packages/permissions/src
ARG RELEASE_REVISION
LABEL org.opencontainers.image.revision=$RELEASE_REVISION
ENV NODE_ENV=production
USER node
WORKDIR /workspace/apps/worker
CMD ["node", "dist/main.js"]
