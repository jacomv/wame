FROM node:20-alpine

# python3/make/g++ compilan los módulos nativos (better-sqlite3, sharp).
# ffmpeg NO es de compilación: Baileys lo invoca por exec en tiempo de envío
# para sacar el thumbnail de un video (Utils/messages-media.js). Sin él el
# fallo se traga en debug y el mensaje sale sin preview. Si algún día esto pasa
# a multi-stage, ffmpeg va en la etapa final, no en la de build.
RUN apk add --no-cache python3 make g++ ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY src/ ./src/

# Sesiones, webhooks y base de datos persisten en este volumen
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "src/index.js"]
