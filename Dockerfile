FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY src/ ./src/

# Las sesiones persisten en este volumen
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "src/index.js"]
