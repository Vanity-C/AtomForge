FROM node:24-bookworm-slim
WORKDIR /runner
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY app/runner/package*.json ./
RUN npm ci
RUN node -e "require('fs').mkdirSync('/etc/ssl/certs',{recursive:true});require('fs').writeFileSync('/etc/ssl/certs/ca-certificates.crt',require('tls').rootCertificates.join('\n'))" \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && printf 'Acquire::Retries "3";\nAcquire::https::Timeout "20";\n' > /etc/apt/apt.conf.d/80-retries \
    && npx playwright install --with-deps chromium --only-shell
COPY app/runner/ ./
RUN mkdir -p /tmp/af-jobs && chown node:node /tmp/af-jobs
ENV PORT=8001
USER node
EXPOSE 8001
CMD ["node", "server.mjs"]
