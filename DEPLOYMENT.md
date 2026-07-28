# S2I Hinglish Recorder - Deployment Guide

## Overview

The S2I Hinglish Recorder is a full-stack web application for collecting speech data for Hinglish (Hindi-English code-mixed) speech recognition model training.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Web     │    │   FastAPI       │    │   SQLite        │
│   Frontend      │◄──►│   Backend       │◄──►│   Database      │
│   (Port 3000)   │    │   (Port 8000)   │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Prerequisites

- **Python 3.9+** with pip and virtual environment support
- **Node.js 16+** with npm
- **Git** for version control
- **nginx** (for production reverse proxy)
- **systemd** (for service management on Linux)

## Quick Start

### 1. Clone and Setup
```bash
git clone <your-repo-url>
cd S2i_recorder
cp .env.example .env
# Edit .env with your configuration
```

### 2. Backend Setup
```bash
cd api
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Initialize database and load scenarios
python -c "from app.database import init_db; import asyncio; asyncio.run(init_db())"
python -c "from app.seed import seed_scenarios; import asyncio; asyncio.run(seed_scenarios())"
```

### 3. Frontend Setup
```bash
cd web
npm install
npm run build
```

### 4. Start Services
```bash
# Start API server
cd api
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Start web server (development)
cd web
npm run dev
```

## Production Deployment

### Environment Configuration

Copy `.env.example` to `.env` and set the production values. The full list of
supported settings lives in `.env.example`; the ones that matter for a
production deploy are:

On Render, the API now treats a hosted service as production even if
`APP_ENV` is missing, so leaving the secrets unset will fail startup instead of
silently using the development defaults.

```bash
# Turns on fail-hard validation. Without this the API silently falls back to
# development defaults (ephemeral JWT key, 'admin123' password).
APP_ENV=production

# Database (four slashes for an absolute SQLite path)
DATABASE_URL=sqlite+aiosqlite:////app/data/s2i_recorder.db

# Security - generate real secrets. The variable is JWT_SECRET_KEY, not
# SECRET_KEY; a misspelling here is ignored and the API falls back to an
# ephemeral key that logs every admin out on restart.
JWT_SECRET_KEY=$(openssl rand -hex 32)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(openssl rand -base64 32)

# CORS - explicit origins only. Credentials are allowed, so a wildcard would
# let any site drive the API as a logged-in admin.
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Storage
STORAGE_BASE_PATH=/app/storage

# Server
LOG_LEVEL=INFO
```

> **ffmpeg is required.** The API transcodes every confirmed clip to 16 kHz
> mono WAV. With `APP_ENV=production` the service refuses to start if ffmpeg is
> missing, rather than accepting recordings it can never process. The provided
> `Dockerfile` installs it; if you deploy without Docker, install it yourself
> (`apt-get install ffmpeg`) or set `FFMPEG_PATH`.

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY api/ ./api/
COPY data/ ./data/
COPY .env .

# Create storage directories
RUN mkdir -p storage/{raw,processed,exports}

# Initialize database
RUN cd api && python -c "from app.database import init_db; import asyncio; asyncio.run(init_db())"
RUN cd api && python -c "from app.seed import seed_scenarios; import asyncio; asyncio.run(seed_scenarios())"

EXPOSE 8000

CMD ["uvicorn", "api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Systemd Service

Create `/etc/systemd/system/s2i-recorder.service`:

```ini
[Unit]
Description=S2I Hinglish Recorder API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/s2i_recorder
Environment=PATH=/opt/s2i_recorder/api/.venv/bin
ExecStart=/opt/s2i_recorder/api/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

### Nginx Configuration

Create `/etc/nginx/sites-available/s2i-recorder`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    client_max_body_size 20M;

    # API endpoints
    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static files
    location / {
        root /opt/s2i_recorder/web/dist;
        try_files $uri $uri/ /index.html;
    }

    # Audio file serving
    location /storage/ {
        root /opt/s2i_recorder;
        add_header Access-Control-Allow-Origin *;
    }
}
```

## Security Considerations

### 1. Authentication
- Change default admin credentials
- Use strong, unique passwords
- Consider implementing 2FA for admin accounts

### 2. HTTPS
- Use SSL/TLS certificates (Let's Encrypt recommended)
- Force HTTPS redirects
- Enable HSTS headers

### 3. CORS
- Configure CORS origins to match your domain only
- Avoid wildcard (*) origins in production

### 4. File Upload Security
- Validate file types and sizes
- Scan uploads for malware if possible
- Store uploads outside web root

### 5. Database Security
- Regular backups
- Proper file permissions (600 for SQLite)
- Consider database encryption for sensitive data

## Data Management

### Backup Strategy
```bash
# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
cp /app/data/s2i_recorder.db /backups/s2i_recorder_$DATE.db
tar -czf /backups/storage_$DATE.tar.gz /app/storage/
# Upload to cloud storage...
```

### Speaker Data Privacy
- GDPR/privacy law compliance
- Speaker withdrawal functionality tested
- Anonymous data export with no PII
- Regular audit of data retention

## Monitoring & Maintenance

### Health Checks
```bash
# API health check
curl -f http://localhost:8000/api/health || exit 1

# Database check
sqlite3 /app/data/s2i_recorder.db "SELECT COUNT(*) FROM speakers;"
```

### Log Management
- API logs: `/app/logs/api.log`
- Web server logs: `/var/log/nginx/`
- Application metrics via FastAPI middleware

### Performance Optimization
- Enable gzip compression in nginx
- Set proper caching headers for static assets
- Consider CDN for audio file delivery
- Database indexing for large datasets

## Scaling Considerations

### High Traffic
- Use redis for session storage
- Implement API rate limiting
- Load balancing with multiple API instances
- Database connection pooling

### Storage Scaling
- Migrate to S3/R2 for object storage
- Implement CDN for audio delivery
- Compress audio files (opus codec)
- Automated cleanup of old recordings

## Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   lsof -ti:8000 | xargs kill -9
   ```

2. **Database locked**
   ```bash
   fuser -k /app/data/s2i_recorder.db
   ```

3. **Permission issues**
   ```bash
   chown -R www-data:www-data /app
   chmod -R 755 /app
   ```

4. **Audio upload failures**
   - Check file size limits
   - Verify MIME type support
   - Ensure storage directory permissions

### Debug Mode
```bash
export LOG_LEVEL=DEBUG
uvicorn app.main:app --reload --log-level debug
```

## Support

For issues and contributions:
- GitHub Issues: [Create Issue]
- Documentation: [Project Wiki]
- Contact: [Your Contact Info]

---

**Note**: This deployment guide covers basic production setup. For enterprise deployments, consider additional security hardening, monitoring solutions, and disaster recovery procedures.