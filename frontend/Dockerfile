# Fase 1 — placeholder de Juliaca Limpia.
# En la Fase 2 se reemplaza este contenido por la aplicación Angular 19.
# El build detecta angular.json y compila automáticamente.

FROM node:22-alpine AS build

WORKDIR /app
COPY . .

RUN set -e; \
    if [ -f package.json ]; then \
        if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
        npm run build -- --configuration production; \
        mkdir -p /out; \
        cp -r dist/*/browser/. /out/; \
    else \
        mkdir -p /out; \
        cp -r placeholder/. /out/; \
    fi

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
