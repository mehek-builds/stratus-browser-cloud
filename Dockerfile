FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev
COPY . .

ENV PORT=4100 \
    CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome \
    STRATUS_DATA_DIR=/data
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD curl -fsS http://localhost:4100/ready || exit 1
CMD ["node", "src/server.js"]
