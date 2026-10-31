FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm test

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4310 BACKOFFICE_HOST=0.0.0.0 BACKOFFICE_STATE_DIR=/state
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
RUN mkdir /state && chown node:node /state
USER node
EXPOSE 4310
VOLUME ["/state"]
CMD ["node", "server/index.mjs"]
