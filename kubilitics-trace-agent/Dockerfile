FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /trace-agent ./cmd/agent/

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /trace-agent /usr/local/bin/trace-agent
EXPOSE 4317 4318 9417
ENTRYPOINT ["trace-agent"]
