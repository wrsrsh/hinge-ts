FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json .
COPY src ./src
RUN npm run build

WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci

COPY mcp/tsconfig.json ./
COPY mcp/src ./src
RUN npm run build

# The file:.. dependency is a symlink during development. Copy the runtime
# dependencies without following that symlink, then add the built SDK.
RUN mkdir /runtime-node_modules \
    && find node_modules -mindepth 1 -maxdepth 1 ! -name hinge-ts -exec cp -a {} /runtime-node_modules/ \; \
    && mkdir /runtime-node_modules/hinge-ts \
    && cp /app/package.json /runtime-node_modules/hinge-ts/package.json \
    && cp -a /app/dist /runtime-node_modules/hinge-ts/dist

FROM node:22-alpine

WORKDIR /app/mcp

COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/mcp/dist ./dist
COPY --from=build /runtime-node_modules ./node_modules

ENV HINGE_MCP_HOST=0.0.0.0
ENV HINGE_MCP_PORT=3939
ENV HINGE_SESSION_FILE=/data/hinge/session.json
ENV HINGE_MCP_READ_ONLY=1

RUN mkdir -p /data/hinge \
    && addgroup -S hinge \
    && adduser -S -G hinge hinge \
    && chown -R hinge:hinge /app /data/hinge

USER hinge
EXPOSE 3939

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3939/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/cli.js", "--http", "3939"]
