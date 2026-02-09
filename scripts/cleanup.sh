#!/bin/bash

# Cleanup Script - Remove all Azure resources

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
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

print_warning "=========================================="
print_warning "WARNING: This will DELETE the following resources:"
print_warning "=========================================="
echo "  - Resource Group: $RESOURCE_GROUP"
echo "  - AKS Cluster: $AKS_CLUSTER_NAME"
echo "  - ACR: $ACR_NAME"
echo "  - Application Insights: $APP_INSIGHTS_NAME"
echo "  - All associated resources"
print_warning "=========================================="
echo ""

read -p "Are you sure you want to delete these resources? (type 'yes' to confirm): " -r
echo

if [[ ! $REPLY == "yes" ]]; then
    print_info "Cleanup cancelled."
    exit 0
fi

print_warning "Starting cleanup..."

# Delete namespace (faster than waiting for cluster deletion)
print_info "Deleting Kubernetes namespace..."
kubectl delete namespace $NAMESPACE --ignore-not-found=true || print_warning "Namespace deletion failed or already deleted"

# Delete entire resource group (includes all resources)
print_info "Deleting resource group '$RESOURCE_GROUP'..."
print_warning "This may take 10-15 minutes..."

az group delete \
  --name $RESOURCE_GROUP \
  --yes \
  --no-wait

print_info ""
print_info "Cleanup initiated!"
print_info "Resource group deletion is running in the background."
print_info ""
print_info "To check deletion status:"
print_info "  az group show --name $RESOURCE_GROUP"
print_info ""
print_info "Cleanup outputs:"
rm -f setup-outputs.env image-refs.env
print_info "  - Removed setup-outputs.env"
print_info "  - Removed image-refs.env"
print_info ""
