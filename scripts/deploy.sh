#!/bin/bash

# Deploy Applications to AKS

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Load configuration
if [ ! -f "config.env" ]; then
    print_error "config.env not found!"
    exit 1
fi

source config.env

# Load image references
if [ ! -f "image-refs.env" ]; then
    print_error "image-refs.env not found! Run ./scripts/build-and-push.sh first."
    exit 1
fi

source image-refs.env

print_info "Deploying to namespace: $NAMESPACE"
print_info "Frontend image: $FRONTEND_IMAGE"
print_info "Backend image: $BACKEND_IMAGE"

# Create temporary deployment file with substituted values
print_info "Preparing deployment manifests..."

cat k8s/deployment.yaml | \
  sed "s|otel-3tier|$NAMESPACE|g" | \
  sed "s|monitorregistry.azurecr.io/otel-3tier-frontend:latest|$FRONTEND_IMAGE|g" | \
  sed "s|monitorregistry.azurecr.io/otel-3tier-backend:latest|$BACKEND_IMAGE|g" \
  > /tmp/deployment-temp.yaml

# Deploy
print_info "Applying deployment..."
kubectl apply -f /tmp/deployment-temp.yaml -n $NAMESPACE

# Wait for deployments
print_info "Waiting for pods to be ready..."
print_warning "This may take 2-3 minutes..."

kubectl wait --for=condition=ready pod -l app=postgres -n $NAMESPACE --timeout=300s
kubectl wait --for=condition=ready pod -l app=backend -n $NAMESPACE --timeout=300s
kubectl wait --for=condition=ready pod -l app=frontend -n $NAMESPACE --timeout=300s

# Get pod status
print_info "Pod status:"
kubectl get pods -n $NAMESPACE

# Wait for LoadBalancer IP
print_info "Waiting for frontend LoadBalancer IP..."
kubectl wait --for=jsonpath='{.status.loadBalancer.ingress[0].ip}' \
  service/frontend -n $NAMESPACE --timeout=300s || print_warning "LoadBalancer IP not assigned yet"

# Get service information
FRONTEND_IP=$(kubectl get svc frontend -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")

print_info ""
print_info "=========================================="
print_info "Deployment completed!"
print_info "=========================================="
print_info ""

if [ "$FRONTEND_IP" != "pending" ]; then
    print_info "Frontend URL: http://$FRONTEND_IP"
    print_info ""
    print_info "Test the application:"
    print_info "  curl http://$FRONTEND_IP/api/users"
    print_info "  curl http://$FRONTEND_IP/api/stats"
else
    print_warning "Frontend LoadBalancer IP is still pending."
    print_info "Check IP with: kubectl get svc frontend -n $NAMESPACE"
fi

print_info ""
print_info "Verify OpenTelemetry configuration:"
print_info "  kubectl exec -n $NAMESPACE deployment/frontend -- env | grep OTEL"
print_info ""
print_info "Check logs:"
print_info "  kubectl logs -n $NAMESPACE deployment/frontend --tail=50"
print_info "  kubectl logs -n $NAMESPACE deployment/backend --tail=50"
print_info ""
print_info "Generate traffic and wait 3-5 minutes, then check Application Insights!"
print_info ""

# Cleanup temp file
rm -f /tmp/deployment-temp.yaml
