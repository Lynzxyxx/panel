FROM node:20-bookworm-slim

# Python + alat build supaya bot Node.js maupun Python bisa memasang dependensinya
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv build-essential git curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv && chown -R node:node /opt/venv
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
