FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# No dependencies: only Node's built-in fetch, fs and crypto are used.
COPY package.json ./
COPY src ./src

CMD ["node", "src/index.js"]
