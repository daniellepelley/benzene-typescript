# Build context MUST be the repo root (npm workspaces resolve @benzene/* packages from src/* via
# symlinks the root install creates - this example's package.json depends on them by workspace version,
# not a published npm version):
#   docker build -f examples/k8s-orders/Dockerfile -t k8s-orders:local .
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY src ./src
COPY examples/k8s-orders ./examples/k8s-orders
RUN npm install

ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "examples/k8s-orders/src/app.ts"]
