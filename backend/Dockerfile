
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY src ./src

EXPOSE 5000

CMD ["sh", "-c", "node src/seed.js && node src/server.js"]
