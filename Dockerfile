# Static page on nginx — for Coolify (Build Pack: Dockerfile, port 80).
FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/40-basic-auth.sh /docker-entrypoint.d/40-basic-auth.sh
RUN chmod +x /docker-entrypoint.d/40-basic-auth.sh
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
