# OpenTelemetry Auto-Configuration for AKS - Setup Guide

This guide walks you through setting up the complete demo with your own Azure resources.

## Prerequisites

- Azure subscription with sufficient permissions
- Azure CLI installed and logged in
- `kubectl` installed
- Docker installed (for building images)
- `jq` installed (for JSON parsing)

## Architecture

```
Applications (Node.js + OpenTelemetry SDK)
    ↓ OTLP/HTTP (Binary Protobuf)
Azure Monitor Agent (AMA) on each node
    ↓ Routes via DCR
Data Collection Rule (DCR)
    ↓
Application Insights
```

## Step 1: Set Configuration Variables

Create a `config.env` file with your settings:

```bash
# Azure Configuration
export SUBSCRIPTION_ID="your-subscription-id"
export RESOURCE_GROUP="otel-demo-rg"
export LOCATION="eastus"

# AKS Configuration
export AKS_CLUSTER_NAME="otel-demo-cluster"
export AKS_NODE_COUNT=2
export AKS_NODE_SIZE="Standard_DS2_v2"

# ACR Configuration
export ACR_NAME="oteldemoacr$(date +%s)"  # Must be globally unique
export ACR_SKU="Basic"

# Application Insights Configuration
export APP_INSIGHTS_NAME="otel-demo-insights"

# Application Configuration
export NAMESPACE="otel-demo"
export FRONTEND_IMAGE_TAG="latest"
export BACKEND_IMAGE_TAG="latest"
```

Load the configuration:
```bash
source config.env
```

## Step 2: Create Azure Resources

### 2.1 Set Active Subscription

```bash
az account set --subscription $SUBSCRIPTION_ID
```

### 2.2 Create Resource Group

```bash
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION
```

### 2.3 Create Azure Container Registry (ACR)

```bash
# Create ACR
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku $ACR_SKU

# Log in to ACR
az acr login --name $ACR_NAME

# Get ACR login server
export ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer -o tsv)
echo "ACR Login Server: $ACR_LOGIN_SERVER"
```

### 2.4 Create AKS Cluster with Azure Monitor Add-on

```bash
az aks create \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME \
  --node-count $AKS_NODE_COUNT \
  --node-vm-size $AKS_NODE_SIZE \
  --enable-managed-identity \
  --attach-acr $ACR_NAME \
  --enable-azure-monitor-metrics \
  --generate-ssh-keys
```

**Note:** The `--enable-azure-monitor-metrics` flag installs Azure Monitor Agent (AMA) which is required for OTLP ingestion.

### 2.5 Get AKS Credentials

```bash
az aks get-credentials \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME \
  --overwrite-existing
```

Verify connection:
```bash
kubectl get nodes
```

### 2.6 Create Application Insights

```bash
# Create Application Insights
az monitor app-insights component create \
  --app $APP_INSIGHTS_NAME \
  --location $LOCATION \
  --resource-group $RESOURCE_GROUP \
  --application-type web

# Get Application Insights details
export APP_INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
  --app $APP_INSIGHTS_NAME \
  --resource-group $RESOURCE_GROUP \
  --query connectionString -o tsv)

export APP_INSIGHTS_APP_ID=$(az monitor app-insights component show \
  --app $APP_INSIGHTS_NAME \
  --resource-group $RESOURCE_GROUP \
  --query appId -o tsv)

echo "Application Insights Connection String: $APP_INSIGHTS_CONNECTION_STRING"
echo "Application Insights App ID: $APP_INSIGHTS_APP_ID"
```

## Step 3: Configure Azure Monitor Auto-Configuration

### 3.1 Create Namespace with Auto-Configuration Annotation

```bash
kubectl create namespace $NAMESPACE

kubectl annotate namespace $NAMESPACE \
  instrumentation.opentelemetry.io/inject-configuration="true"
```

### 3.2 Create Instrumentation Custom Resource

Save the App Insights connection string to use in the next step:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: monitor.azure.com/v1
kind: Instrumentation
metadata:
  name: default
  namespace: $NAMESPACE
spec:
  destination:
    applicationInsightsConnectionString: "$APP_INSIGHTS_CONNECTION_STRING"
  settings:
    autoInstrumentationPlatforms: []
EOF
```

### 3.3 Verify Instrumentation CR

```bash
kubectl get instrumentation -n $NAMESPACE
kubectl describe instrumentation default -n $NAMESPACE
```

## Step 4: Build and Push Application Images

### 4.1 Build Images

```bash
# Build frontend
docker build --platform linux/amd64 \
  -t $ACR_LOGIN_SERVER/otel-demo-frontend:$FRONTEND_IMAGE_TAG \
  -f frontend/Dockerfile \
  frontend/

# Build backend
docker build --platform linux/amd64 \
  -t $ACR_LOGIN_SERVER/otel-demo-backend:$BACKEND_IMAGE_TAG \
  -f backend/Dockerfile \
  backend/
```

### 4.2 Push Images to ACR

```bash
docker push $ACR_LOGIN_SERVER/otel-demo-frontend:$FRONTEND_IMAGE_TAG
docker push $ACR_LOGIN_SERVER/otel-demo-backend:$BACKEND_IMAGE_TAG
```

## Step 5: Update Kubernetes Manifests

### 5.1 Update deployment.yaml with your ACR

Edit `k8s/deployment.yaml` and replace the image references:

```bash
# Use sed to replace image references (macOS)
sed -i '' "s|monitorregistry.azurecr.io/otel-3tier-frontend:latest|$ACR_LOGIN_SERVER/otel-demo-frontend:$FRONTEND_IMAGE_TAG|g" k8s/deployment.yaml
sed -i '' "s|monitorregistry.azurecr.io/otel-3tier-backend:latest|$ACR_LOGIN_SERVER/otel-demo-backend:$BACKEND_IMAGE_TAG|g" k8s/deployment.yaml

# For Linux, use:
# sed -i "s|monitorregistry.azurecr.io/otel-3tier-frontend:latest|$ACR_LOGIN_SERVER/otel-demo-frontend:$FRONTEND_IMAGE_TAG|g" k8s/deployment.yaml
# sed -i "s|monitorregistry.azurecr.io/otel-3tier-backend:latest|$ACR_LOGIN_SERVER/otel-demo-backend:$BACKEND_IMAGE_TAG|g" k8s/deployment.yaml
```

Or manually edit `k8s/deployment.yaml` to update:
- `image: YOUR_ACR.azurecr.io/otel-demo-frontend:latest`
- `image: YOUR_ACR.azurecr.io/otel-demo-backend:latest`

## Step 6: Deploy Applications

```bash
# Deploy all resources
kubectl apply -f k8s/deployment.yaml -n $NAMESPACE

# Wait for pods to be ready
kubectl wait --for=condition=ready pod -l app=frontend -n $NAMESPACE --timeout=300s
kubectl wait --for=condition=ready pod -l app=backend -n $NAMESPACE --timeout=300s
kubectl wait --for=condition=ready pod -l app=postgres -n $NAMESPACE --timeout=300s
```

## Step 7: Verify Deployment

### 7.1 Check Pods

```bash
kubectl get pods -n $NAMESPACE
```

Expected output:
```
NAME                        READY   STATUS    RESTARTS   AGE
backend-xxxxxxxxx-xxxxx     1/1     Running   0          2m
backend-xxxxxxxxx-xxxxx     1/1     Running   0          2m
frontend-xxxxxxxxx-xxxxx    1/1     Running   0          2m
frontend-xxxxxxxxx-xxxxx    1/1     Running   0          2m
postgres-xxxxxxxxx-xxxxx    1/1     Running   0          2m
```

### 7.2 Check Injected Environment Variables

```bash
# Check what variables were injected
kubectl exec -n $NAMESPACE deployment/frontend -- env | grep OTEL
```

You should see:
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf`
- `OTEL_RESOURCE_ATTRIBUTES` (includes `microsoft.applicationId`)

### 7.3 Check Application Logs

```bash
# Frontend logs
kubectl logs -n $NAMESPACE deployment/frontend --tail=50

# Backend logs
kubectl logs -n $NAMESPACE deployment/backend --tail=50
```

Look for:
- `✅ OpenTelemetry SDK started successfully`
- No error messages

## Step 8: Access the Application

### 8.1 Get Frontend Service External IP

```bash
kubectl get svc frontend -n $NAMESPACE

# Wait for EXTERNAL-IP to be assigned
kubectl wait --for=jsonpath='{.status.loadBalancer.ingress[0].ip}' \
  service/frontend -n $NAMESPACE --timeout=300s

export FRONTEND_URL=$(kubectl get svc frontend -n $NAMESPACE \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo "Frontend URL: http://$FRONTEND_URL"
```

### 8.2 Test the Application

Open in browser:
```bash
echo "http://$FRONTEND_URL"
```

Or test with curl:
```bash
# Get all users
curl http://$FRONTEND_URL/api/users | jq

# Get user statistics
curl http://$FRONTEND_URL/api/stats | jq

# Create a user
curl http://$FRONTEND_URL/api/users/create | jq
```

## Step 9: Verify Telemetry in Application Insights

### 9.1 Generate Traffic

```bash
# Generate multiple requests
for i in {1..10}; do
  curl -s http://$FRONTEND_URL/api/users > /dev/null
  echo "Request $i sent"
  sleep 1
done
```

### 9.2 Query Application Insights (CLI)

Wait 3-5 minutes for data ingestion, then query:

```bash
# Get Application Insights resource ID
export APP_INSIGHTS_ID=$(az monitor app-insights component show \
  --app $APP_INSIGHTS_NAME \
  --resource-group $RESOURCE_GROUP \
  --query id -o tsv)

# Query recent requests
az monitor app-insights query \
  --app $APP_INSIGHTS_ID \
  --analytics-query "requests | where timestamp > ago(10m) | summarize count() by cloud_RoleName, name | order by count_ desc" \
  --output table

# Query with details
az monitor app-insights query \
  --app $APP_INSIGHTS_ID \
  --analytics-query "requests | where timestamp > ago(10m) | project timestamp, name, cloud_RoleName, resultCode | order by timestamp desc" \
  --output table
```

### 9.3 View in Azure Portal

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your Application Insights resource
3. Click on **"Transaction search"** or **"Application map"**
4. View distributed traces showing:
   - Frontend → Backend → Database calls
   - Request timing and dependencies
   - Service topology

## Step 10: View Application Map

```bash
# Open Application Insights in browser
echo "https://portal.azure.com/#@/resource$APP_INSIGHTS_ID/overview"
```

In the portal:
1. Go to **"Application map"** (left menu)
2. You should see:
   - `[otel-demo]/frontend` node
   - `[otel-demo]/backend` node
   - Dependencies between them
   - Database dependencies

## Troubleshooting

### Issue: No data in Application Insights

**Check 1: Verify environment variables are injected**
```bash
kubectl exec -n $NAMESPACE deployment/frontend -- env | grep OTEL
```

**Check 2: Verify no errors in pod logs**
```bash
kubectl logs -n $NAMESPACE deployment/frontend | grep -i error
```

**Check 3: Verify AMA pods are running**
```bash
kubectl get pods -n kube-system | grep ama
```

**Check 4: Restart AMA pods** (they need to pick up new namespace config)
```bash
kubectl delete pods -n kube-system -l rsName=ama-logs
kubectl delete pods -n kube-system -l app=ama-metrics-node
```

**Check 5: Verify DCR association**
```bash
az monitor data-collection rule association list \
  --resource "/subscriptions/$SUBSCRIPTION_ID/resourcegroups/$RESOURCE_GROUP/providers/Microsoft.ContainerService/managedClusters/$AKS_CLUSTER_NAME" \
  --query "[].{name:name, dcrName:dataCollectionRuleId}" \
  --output table
```

Look for an association with your namespace name.

### Issue: 400 Bad Request errors in logs

This typically means SDK version incompatibility. Ensure you're using:
- `@opentelemetry/sdk-node`: `^0.211.0`
- `@opentelemetry/api`: `^1.9.0`
- `@opentelemetry/auto-instrumentations-node`: `^0.52.0`

### Issue: Pods not starting

**Check image pull permissions:**
```bash
kubectl describe pod -n $NAMESPACE <pod-name>
```

**Verify ACR attachment:**
```bash
az aks show --name $AKS_CLUSTER_NAME --resource-group $RESOURCE_GROUP --query "servicePrincipalProfile"
```

## Cleanup

To remove all resources:

```bash
# Delete namespace and all resources
kubectl delete namespace $NAMESPACE

# Delete AKS cluster
az aks delete \
  --name $AKS_CLUSTER_NAME \
  --resource-group $RESOURCE_GROUP \
  --yes --no-wait

# Delete Application Insights
az monitor app-insights component delete \
  --app $APP_INSIGHTS_NAME \
  --resource-group $RESOURCE_GROUP

# Delete ACR
az acr delete \
  --name $ACR_NAME \
  --resource-group $RESOURCE_GROUP \
  --yes

# Delete Resource Group (removes everything)
az group delete \
  --name $RESOURCE_GROUP \
  --yes --no-wait
```

## Cost Considerations

Estimated monthly costs (US East region):
- AKS (2 x Standard_DS2_v2 nodes): ~$140/month
- Azure Container Registry (Basic): ~$5/month
- Application Insights: Pay-as-you-go (first 5GB free)
- Egress bandwidth: Variable

**To minimize costs:**
- Use smaller node sizes during testing
- Delete resources when not in use
- Use Basic ACR tier
- Monitor Application Insights ingestion

## Next Steps

- **Enable distributed tracing**: View end-to-end traces in Application Insights
- **Create custom metrics**: Add custom instrumentation to your code
- **Set up alerts**: Configure alerts based on telemetry data
- **Add more services**: Expand to microservices architecture
- **Try different languages**: Python, Java, .NET all support OpenTelemetry

## References

- [Azure Monitor OpenTelemetry for AKS](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Application Insights Overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
