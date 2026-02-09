#!/bin/bash

# Build and Push Docker Images Script

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Load configuration
if [ ! -f "config.env" ]; then
    print_error "config.env not found!"
    exit 1
fi

source config.env

# Load setup outputs
if [ ! -f "setup-outputs.env" ]; then
    print_error "setup-outputs.env not found! Run ./scripts/setup.sh first."
    exit 1
fi

source setup-outputs.env

print_info "Building Docker images..."
print_info "ACR: $ACR_LOGIN_SERVER"

# Build frontend
print_info "Building frontend image..."
docker build --platform linux/amd64 \
  -t $ACR_LOGIN_SERVER/otel-demo-frontend:${FRONTEND_IMAGE_TAG:-latest} \
  -f frontend/Dockerfile \
  frontend/

# Build backend
print_info "Building backend image..."
docker build --platform linux/amd64 \
  -t $ACR_LOGIN_SERVER/otel-demo-backend:${BACKEND_IMAGE_TAG:-latest} \
  -f backend/Dockerfile \
  backend/

# Push images
print_info "Pushing images to ACR..."

docker push $ACR_LOGIN_SERVER/otel-demo-frontend:${FRONTEND_IMAGE_TAG:-latest}
docker push $ACR_LOGIN_SERVER/otel-demo-backend:${BACKEND_IMAGE_TAG:-latest}

# Save image references
cat > image-refs.env <<EOF
export FRONTEND_IMAGE="$ACR_LOGIN_SERVER/otel-demo-frontend:${FRONTEND_IMAGE_TAG:-latest}"
export BACKEND_IMAGE="$ACR_LOGIN_SERVER/otel-demo-backend:${BACKEND_IMAGE_TAG:-latest}"
EOF

print_info "Images built and pushed successfully!"
print_info "Image references saved to image-refs.env"
print_info ""
print_info "Frontend: $ACR_LOGIN_SERVER/otel-demo-frontend:${FRONTEND_IMAGE_TAG:-latest}"
print_info "Backend: $ACR_LOGIN_SERVER/otel-demo-backend:${BACKEND_IMAGE_TAG:-latest}"
print_info ""
print_info "Next step: ./scripts/deploy.sh"
