FROM golang:1.23-alpine AS build

RUN apk add --no-cache ca-certificates git
WORKDIR /src

# go.sum es opcional en el primer build: go mod download lo genera.
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN go mod tidy \
    && CGO_ENABLED=0 GOOS=linux go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 appuser

ENV TZ=America/Lima
COPY --from=build /out/api /usr/local/bin/api

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
    CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/api"]
