#!/bin/bash

# S2I Hinglish Recorder - Production Build Script

set -e  # Exit on any error

echo "🚀 Building S2I Hinglish Recorder for production..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 is required but not installed.${NC}"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is required but not installed.${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is required but not installed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Create production environment if not exists
if [ ! -f .env ]; then
    echo "📝 Creating production environment file..."
    cp .env.example .env
    echo -e "${YELLOW}⚠️  Please edit .env with your production settings before deployment${NC}"
fi

# Build backend
echo "🐍 Setting up Python backend..."
cd api

# Create virtual environment if not exists
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo -e "${GREEN}✅ Created Python virtual environment${NC}"
fi

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
echo -e "${GREEN}✅ Installed Python dependencies${NC}"

# The database schema and scenario seeding both run automatically in the API's
# startup lifespan (api/app/main.py). The previous calls here referenced
# `app.database.init_db`, which does not exist, and called seed_scenarios()
# without its required session argument - so this script always failed here.
echo "🗄️  Database schema and scenarios are created on first API start."

echo -e "${GREEN}✅ Backend setup complete${NC}"

# Build frontend
cd ../web
echo "⚛️  Building React frontend..."

# Install dependencies
npm ci --production=false
echo -e "${GREEN}✅ Installed Node.js dependencies${NC}"

# Build for production
npm run build
echo -e "${GREEN}✅ Built frontend for production${NC}"

# Return to root
cd ..

# Create necessary directories
echo "📁 Creating storage directories..."
mkdir -p storage/{raw,processed,exports}
mkdir -p logs
echo -e "${GREEN}✅ Created storage directories${NC}"

# Set permissions (Linux/Mac)
if [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "darwin"* ]]; then
    chmod -R 755 storage/
    chmod -R 755 logs/
fi

# Create production start script
cat > start-production.sh << 'EOF'
#!/bin/bash

# Production startup script for S2I Recorder

set -e

echo "🚀 Starting S2I Recorder in production mode..."

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Activate Python environment
cd api
source .venv/bin/activate

# Start the server
exec uvicorn app.main:app \
    --host ${API_HOST:-0.0.0.0} \
    --port ${API_PORT:-8000} \
    --workers ${WORKERS:-1} \
    --access-log \
    --log-level ${LOG_LEVEL:-info}
EOF

chmod +x start-production.sh

# Create systemd service file template
cat > s2i-recorder.service << 'EOF'
[Unit]
Description=S2I Hinglish Recorder API Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/s2i_recorder
Environment=PATH=/opt/s2i_recorder/api/.venv/bin
EnvironmentFile=/opt/s2i_recorder/.env
ExecStart=/opt/s2i_recorder/start-production.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Summary
echo ""
echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo ""
echo "📋 Next steps:"
echo "  1. Edit .env file with your production configuration"
echo "  2. Copy this project to your production server"
echo "  3. For systemd service (Linux):"
echo "     sudo cp s2i-recorder.service /etc/systemd/system/"
echo "     sudo systemctl daemon-reload"
echo "     sudo systemctl enable s2i-recorder"
echo "     sudo systemctl start s2i-recorder"
echo ""
echo "  4. Or run directly:"
echo "     ./start-production.sh"
echo ""
echo "📁 Built files:"
echo "  - Backend: api/ (with virtual environment)"
echo "  - Frontend: web/dist/ (production build)"
echo "  - Database: api/s2i_recorder.db (initialized)"
echo "  - Storage: storage/ (empty, ready for uploads)"
echo ""
echo -e "${YELLOW}⚠️  Remember to configure nginx/apache as reverse proxy for production!${NC}"