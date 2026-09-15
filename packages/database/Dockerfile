FROM node:26.8.2-bookworm-slim
RUN npm install --global pnpm@12.4.1
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json packages/database/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN pnpm install --frozen-lockfile --filter @workspace/database... --prod
COPY packages/database/src packages/database/src
COPY packages/database/migrations packages/database/migrations
USER node
WORKDIR /workspace/packages/database
CMD ["node", "src/migrate.ts"]
