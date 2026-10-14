FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY . .

RUN corepack enable \
  && corepack prepare pnpm@11.25.0 --activate \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @medicare/service-web build

EXPOSE 3000

CMD ["node", "scripts/compose-service.mjs"]
