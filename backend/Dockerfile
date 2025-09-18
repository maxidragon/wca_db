FROM node:20-bullseye
RUN apt-get update && apt-get install -y --no-install-recommends unzip wget ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
