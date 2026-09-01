FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server

COPY src/game.ts ./src/game.ts
COPY server/src ./server/src
COPY server/tsconfig.json ./server/tsconfig.json
RUN npm run build --prefix server && npm prune --omit=dev --prefix server

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    ABC_HOST=0.0.0.0 \
    ABC_PORT=8787
WORKDIR /app/server

COPY --from=build --chown=node:node /app/server/package.json /app/server/package-lock.json ./
COPY --from=build --chown=node:node /app/server/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/dist ./dist

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/cli.js"]
