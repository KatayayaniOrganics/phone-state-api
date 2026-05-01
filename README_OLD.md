# Phone → State Lookup API

Production-ready API for Indian phone number to state mapping.

## Features

- **2,800 prefixes** mapped to states
- **938,000+ verified samples** from real customer data
- **85%+ overall accuracy**, **94%+ on high-confidence results**
- TRAI/DoT base data + MongoDB ground truth
- Fast in-memory lookups (<1ms)
- RESTful HTTP API

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Server runs on http://localhost:3001
```

## API Endpoints

### GET /lookup?phone=<number>
Single phone lookup

**Example:**
```bash
curl "http://localhost:3001/lookup?phone=9826123456"
```

**Response:**
```json
{
  "phone": "9826123456",
  "matched_prefix": "9826",
  "state": "Madhya Pradesh",
  "confidence": 0.95,
  "source": "ground_truth",
  "samples": 2726,
  "operator": "Vodafone Idea",
  "alternates": [
    {"state": "Chhattisgarh", "share": 0.03}
  ]
}
```

### POST /bulk
Bulk lookup (max 500 phones per request)

**Example:**
```bash
curl -X POST http://localhost:3001/bulk \
  -H "Content-Type: application/json" \
  -d '{"phones":["9826123456","6202123456"]}'
```

### GET /stats
Get mapping statistics

### GET /health
Health check

## Confidence Levels

| Level | Range | Accuracy | Use Case |
|-------|-------|----------|----------|
| **High** | ≥0.85 | **94%** | Use for critical decisions |
| Medium | 0.65-0.85 | 74% | Use with caution |
| Low | <0.65 | 54% | Not recommended |

## Production Deployment

### Option 1: PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start
npm run start:pm2

# Status
pm2 status

# Logs
pm2 logs phone-state-api

# Stop
npm run stop:pm2
```

### Option 2: Systemd (Linux)

Create `/etc/systemd/system/phone-state-api.service`:

```ini
[Unit]
Description=Phone State API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/phone-state-api
ExecStart=/usr/bin/node phone_state_api.js
Restart=always
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable phone-state-api
sudo systemctl start phone-state-api
```

### Option 3: Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t phone-state-api .
docker run -d -p 3001:3001 --name phone-state-api phone-state-api
```

## Files

- `phone_state_api.js` - Main API server
- `enhanced_prefix_state.json` - Mapping data (2800 prefixes)
- `build_ground_truth.js` - Rebuild mapping from DB
- `verify_system.js` - Accuracy testing

## License

MIT
