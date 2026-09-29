FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/package.json
COPY backend/tsconfig.json backend/tsconfig.json
COPY frontend/package.json frontend/package.json
COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/tsconfig.app.json frontend/tsconfig.app.json
COPY frontend/tsconfig.node.json frontend/tsconfig.node.json
COPY frontend/vite.config.ts frontend/vite.config.ts
RUN npm install --prefix backend && npm install --prefix frontend
COPY backend backend
COPY frontend frontend
RUN npm run build --prefix frontend && npm run build --prefix backend

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
