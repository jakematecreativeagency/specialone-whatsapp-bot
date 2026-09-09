FROM node:20-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
  chromium \
  libglib2.0-0 \
  libnss3 \
  libxss1 \
  libatk-bridge2.0-0 \
  libgtk-3-0 \
  libgbm-dev \
  libasound2 \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

CMD ["npm", "start"]
