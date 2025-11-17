# Deployment Guide

## Overview

This guide covers deploying the Cognigy MCP Server for production use.

## Prerequisites

- Node.js 20.x or higher
- Access to Cognigy.AI API (trial or production)
- Valid Cognigy API key

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the environment template and configure:

```bash
cp env.template .env
```

Edit `.env` with your credentials:

```env
COGNIGY_API_BASE_URL=https://api-trial.cognigy.ai
COGNIGY_API_KEY=your-actual-api-key
LOG_LEVEL=debug
```

### 3. Build the Project

```bash
npm run build
```

### 4. Run the Server

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Production Deployment

### Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

USER node

CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t cognigy-mcp-server .
docker run -d \
  -e COGNIGY_API_BASE_URL=https://api.cognigy.ai \
  -e COGNIGY_API_KEY=your-api-key \
  --name cognigy-mcp \
  cognigy-mcp-server
```

### Kubernetes Deployment

Example deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cognigy-mcp-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cognigy-mcp-server
  template:
    metadata:
      labels:
        app: cognigy-mcp-server
    spec:
      containers:
      - name: mcp-server
        image: cognigy-mcp-server:latest
        env:
        - name: COGNIGY_API_BASE_URL
          valueFrom:
            secretKeyRef:
              name: cognigy-secrets
              key: api-url
        - name: COGNIGY_API_KEY
          valueFrom:
            secretKeyRef:
              name: cognigy-secrets
              key: api-key
        - name: LOG_LEVEL
          value: "info"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Process Manager (PM2)

For traditional server deployments:

```bash
npm install -g pm2

pm2 start dist/index.js \
  --name cognigy-mcp-server \
  --env production \
  --instances 2 \
  --max-memory-restart 500M

pm2 save
pm2 startup
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COGNIGY_API_BASE_URL` | Yes | - | Base URL for Cognigy API |
| `COGNIGY_API_KEY` | Yes | - | Your Cognigy API key |
| `MCP_SERVER_NAME` | No | `cognigy-api-mcp` | MCP server name |
| `MCP_SERVER_VERSION` | No | `1.0.0` | MCP server version |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in milliseconds |

### Rate Limiting

Adjust rate limits based on your API quota:

- Free tier: 10 requests/minute
- Trial: 100 requests/minute
- Production: 1000+ requests/minute

Example for production:

```bash
RATE_LIMIT_MAX_REQUESTS=1000
RATE_LIMIT_WINDOW_MS=60000
```

## Monitoring

### Logging

The server logs all operations with structured logging. Configure log level:

- `debug`: Verbose logging including all API calls
- `info`: Standard operational logging
- `warn`: Warnings and potential issues
- `error`: Errors only

### Health Checks

Implement health check endpoint (not included in basic implementation):

```typescript
// Add to src/index.ts
server.setRequestHandler('health', async () => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});
```

### Metrics

Consider adding metrics collection:

- Request count by tool
- Response times
- Error rates
- Rate limit hits

## Security

### API Key Management

1. **Never commit API keys** to version control
2. **Use environment variables** or secret management systems
3. **Rotate keys regularly** (quarterly recommended)
4. **Use separate keys** for dev, staging, and production
5. **Monitor key usage** in Cognigy dashboard

### Network Security

- Deploy behind firewall/VPN for internal use
- Use TLS/SSL for all connections
- Implement IP allowlisting if needed
- Consider using API gateway for additional security

### Audit Logging

Enable audit logging to track:

- All API operations
- User/system performing operations
- Timestamps
- Success/failure status

## Troubleshooting

### Common Issues

#### 1. Authentication Errors

```
Error: COGNIGY_API_KEY environment variable is required
```

**Solution**: Ensure `.env` file is properly configured and loaded.

#### 2. Rate Limit Exceeded

```
Error: Rate limit exceeded
```

**Solution**: Increase `RATE_LIMIT_MAX_REQUESTS` or wait before retrying.

#### 3. Connection Errors

```
Error: connect ETIMEDOUT
```

**Solution**: Check network connectivity and API base URL.

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm start
```

This will log all API requests and responses.

## Backup and Disaster Recovery

The MCP server is stateless. To restore:

1. Redeploy with same configuration
2. Verify API key is valid
3. Test connectivity to Cognigy API

No data backup needed as server doesn't store state.

## Scaling

### Horizontal Scaling

The server is stateless and can be scaled horizontally:

```bash
# With PM2
pm2 scale cognigy-mcp-server 4

# With Kubernetes
kubectl scale deployment cognigy-mcp-server --replicas=5
```

### Load Balancing

Use any standard load balancer:

- Nginx
- HAProxy
- Cloud load balancers (ALB, NLB, etc.)

No session affinity required.

## Support

For issues with:

- **MCP Server**: Check logs and GitHub issues
- **Cognigy API**: Contact Cognigy support (support@cognigy.com)
- **Authentication**: Verify API key in Cognigy dashboard

