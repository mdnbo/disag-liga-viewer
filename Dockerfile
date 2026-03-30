FROM node:22-alpine
WORKDIR /app
COPY server.js ws-server.js index.html package.json ./
EXPOSE 3000
CMD ["node", "server.js", "--demo"]
