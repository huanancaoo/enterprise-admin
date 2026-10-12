FROM node:26.8.2-alpine3.24@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS build
RUN npm install --global pnpm@12.11.2
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api apps/api
COPY apps/tenant apps/tenant
COPY apps/platform apps/platform
COPY apps/worker apps/worker
COPY packages packages
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm install --store-dir=/pnpm/store --frozen-lockfile --filter api... --filter tenant... --filter platform... --filter worker...
RUN pnpm -r --filter api... --filter tenant... --filter platform... --filter worker... build
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm --filter api deploy --prod --store-dir=/pnpm/store /runtime-api
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm --filter @workspace/database deploy --prod --store-dir=/pnpm/store /runtime-database

FROM node:26.8.2-alpine3.24@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS runtime
# 运行镜像保留 Node、实际依赖与已修复 TLS 库；构建/安装工具不会用于应用运行。
RUN apk add --no-cache libcrypto3=3.5.9-r0 libssl3=3.5.9-r0 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production

FROM runtime AS api
WORKDIR /workspace/apps/api
COPY --from=build /runtime-api ./
ARG RELEASE_REVISION
LABEL org.opencontainers.image.revision=$RELEASE_REVISION
ENV NODE_ENV=production
RUN mkdir -p /data/files && chown node:node /data/files && chmod 0700 /data/files
USER node
WORKDIR /workspace/apps/api
CMD ["node", "dist/main.js"]

FROM runtime AS migrator
WORKDIR /workspace/packages/database
COPY --from=build /runtime-database ./
ARG RELEASE_REVISION
LABEL org.opencontainers.image.revision=$RELEASE_REVISION
USER node
CMD ["node", "src/migrate.ts"]

FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS web
RUN apk add --no-cache libexpat=2.8.5-r0 pcre2=10.49-r0 tiff=4.7.2-r0
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

FROM node:26.8.2-alpine3.24@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS worker-build
RUN npm install --global pnpm@12.11.2
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker apps/worker
COPY packages packages
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm install --store-dir=/pnpm/store --frozen-lockfile --filter worker...
RUN pnpm -r --filter worker... build
RUN --mount=type=cache,id=enterprise-admin-pnpm,target=/pnpm/store,sharing=locked pnpm --filter worker deploy --prod --store-dir=/pnpm/store /runtime-worker

FROM runtime AS worker
WORKDIR /workspace/apps/worker
COPY --from=worker-build /runtime-worker ./
ARG RELEASE_REVISION
LABEL org.opencontainers.image.revision=$RELEASE_REVISION
ENV NODE_ENV=production
USER node
WORKDIR /workspace/apps/worker
CMD ["node", "dist/main.js"]
