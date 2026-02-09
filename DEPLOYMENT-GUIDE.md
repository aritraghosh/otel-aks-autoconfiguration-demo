# Deployment Guide: 3-Tier OpenTelemetry Demo with Azure Monitor Autoconfiguration

## Overview

This demo shows how to use **Azure Monitor's Autoconfiguration** feature for AKS to automatically configure OpenTelemetry-instrumented applications to export telemetry to Azure Monitor without any Azure-specific code.

**Key Features:**
- ✅ Standard OpenTelemetry SDK (no Azure distro)
- ✅ Zero Azure-specific code in your application
- ✅ AKS addon injects OTLP configuration automatically
- ✅ Distributed tracing across frontend → backend → database

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Node.js)                                 │
│  - Standard OTel SDK                                │
│  - OTLP HTTP Exporter                               │
│  - Manual + Auto Instrumentation                    │
└──────────────┬──────────────────────────────────────┘
               │ HTTP
               ▼
┌─────────────────────────────────────────────────────┐
│  Backend (Node.js)                                  │
│  - Standard OTel SDK                                │
│  - OTLP HTTP Exporter                               │
│  - PostgreSQL Auto Instrumentation                  │
└──────────────┬──────────────────────────────────────┘
               │ SQL
               ▼
┌─────────────────────────────────────────────────────┐
│  PostgreSQL Database                                │
└─────────────────────────────────────────────────────┘
               │
               │ OTLP/HTTP (injected by AKS)
               ▼
┌─────────────────────────────────────────────────────┐
│  Azure Monitor Application Insights                 │
│  (with OTLP Support enabled)                        │
└─────────────────────────────────────────────────────┘
```

## Prerequisites

- Azure CLI installed (`az`)
- kubectl installed
- An AKS cluster (or permission to create one)
- An Azure Container Registry (or permission to create one)

## Part 1: Azure Infrastructure Setup

### Step 1: Install AKS Preview Extension

```bash
# Install/update aks-preview extension
az extension add --name aks-preview
az extension update --name aks-preview
```

### Step 2: Register Preview Features

```bash
# Register AKS application monitoring preview
az feature register \
  --namespace "Microsoft.ContainerService" \
  --name "AzureMonitorAppMonitoringPreview"

# Register OTLP in Application Insights preview
az feature register \
  --namespace "Microsoft.Insights" \
  --name "OtlpApplicationInsights"

# Wait for registration to complete (takes ~5-10 minutes)
az feature show \
  --namespace "Microsoft.ContainerService" \
  --name "AzureMonitorAppMonitoringPreview"

az feature show \
  --namespace "Microsoft.Insights" \
  --name "OtlpApplicationInsights"
```

**Wait until both show `"state": "Registered"`**

### Step 3: Register Resource Providers

```bash
az provider register --namespace "Microsoft.ContainerService"
az provider register --namespace "Microsoft.Insights"
```

### Step 4: Create Resource Group

```bash
export RESOURCE_GROUP="otel-demo-rg"
export LOCATION="eastus"
export ACR_NAME="oteldemoregistry"  # Must be globally unique
export CLUSTER_NAME="otel-demo-aks"

az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION
```

### Step 5: Create Azure Container Registry

```bash
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic

# Enable admin account (for docker push)
az acr update \
  --name $ACR_NAME \
  --admin-enabled true

# Get login credentials
az acr credential show --name $ACR_NAME
```

### Step 6: Create AKS Cluster

```bash
az aks create \
  --resource-group $RESOURCE_GROUP \
  --name $CLUSTER_NAME \
  --node-count 2 \
  --node-vm-size Standard_D2s_v3 \
  --enable-managed-identity \
  --attach-acr $ACR_NAME \
  --generate-ssh-keys

# Get credentials
az aks get-credentials \
  --resource-group $RESOURCE_GROUP \
  --name $CLUSTER_NAME
```

### Step 7: Create Log Analytics Workspace and Application Insights

```bash
export WORKSPACE_NAME="otel-demo-workspace"
export APP_INSIGHTS_NAME="otel-demo-appinsights"

# Create Log Analytics Workspace
az monitor log-analytics workspace create \
  --resource-group $RESOURCE_GROUP \
  --workspace-name $WORKSPACE_NAME \
  --location $LOCATION

# Create Application Insights with OTLP support
az monitor app-insights component create \
  --resource-group $RESOURCE_GROUP \
  --app $APP_INSIGHTS_NAME \
  --location $LOCATION \
  --workspace $WORKSPACE_NAME
```

### Step 8: Enable OTLP Support in Application Insights

**IMPORTANT:** This must be done via Azure Portal (not available in CLI yet):

1. Go to Azure Portal
2. Navigate to your Application Insights resource (`otel-demo-appinsights`)
3. Go to **Settings** → **Properties**
4. Find **"Enable OTLP Support (Preview)"** and set to **Enabled**
5. Ensure **"Use managed workspaces"** = **Yes**
6. Click **Save**

### Step 9: Enable Application Monitoring on AKS Cluster

**Option A: Via Azure Portal (Recommended)**

1. Go to Azure Portal → Your AKS cluster
2. Click **Monitor** → **Insights**
3. Click **Configure monitoring**
4. Enable **"Application monitoring"**
5. Select your Application Insights resource
6. Click **Configure**

**Option B: Via Azure CLI (if available)**

```bash
az aks enable-addons \
  --resource-group $RESOURCE_GROUP \
  --name $CLUSTER_NAME \
  --addons monitoring \
  --workspace-resource-id $(az monitor log-analytics workspace show \
    --resource-group $RESOURCE_GROUP \
    --workspace-name $WORKSPACE_NAME \
    --query id -o tsv)
```

### Step 10: Verify Addon Installation

```bash
# Check that OpenTelemetry components are installed
kubectl get pods -n kube-system | grep otel

# You should see pods like:
# ama-logs-otel-*
# ama-metrics-*
```

## Part 2: Build and Push Application Images

### Step 1: Login to ACR

```bash
az acr login --name $ACR_NAME
```

### Step 2: Build and Push Frontend

```bash
cd simple-3tier/frontend

docker build -t $ACR_NAME.azurecr.io/otel-3tier-frontend:latest .

docker push $ACR_NAME.azurecr.io/otel-3tier-frontend:latest
```

### Step 3: Build and Push Backend

```bash
cd ../backend

docker build -t $ACR_NAME.azurecr.io/otel-3tier-backend:latest .

docker push $ACR_NAME.azurecr.io/otel-3tier-backend:latest
```

## Part 3: Deploy Application

### Step 1: Update Deployment Manifest

Edit `simple-3tier/k8s/deployment.yaml` and replace image references:

```yaml
# Backend deployment (line ~113)
image: YOUR_ACR_NAME.azurecr.io/otel-3tier-backend:latest

# Frontend deployment (line ~202)
image: YOUR_ACR_NAME.azurecr.io/otel-3tier-frontend:latest
```

Replace `YOUR_ACR_NAME` with your actual ACR name.

### Step 2: Deploy to Kubernetes

```bash
cd simple-3tier/k8s

kubectl apply -f deployment.yaml
```

### Step 3: Verify Deployment

```bash
# Check pods are running
kubectl get pods -n otel-3tier

# Expected output:
# NAME                        READY   STATUS    RESTARTS   AGE
# backend-xxx                 1/1     Running   0          2m
# backend-yyy                 1/1     Running   0          2m
# frontend-xxx                1/1     Running   0          2m
# frontend-yyy                1/1     Running   0          2m
# postgres-xxx                1/1     Running   0          2m
```

### Step 4: Get Frontend URL

```bash
kubectl get svc frontend -n otel-3tier

# Wait for EXTERNAL-IP to be assigned (may take 2-3 minutes)
```

### Step 5: Test the Application

```bash
export FRONTEND_IP=$(kubectl get svc frontend -n otel-3tier -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Test health endpoint
curl http://$FRONTEND_IP/health

# Test API endpoint
curl http://$FRONTEND_IP/api/users

# Open in browser
open http://$FRONTEND_IP
```

## Part 4: Verify Telemetry Flow

### Step 1: Generate Traffic

```bash
# Generate some traffic to create telemetry
for i in {1..20}; do
  curl -s http://$FRONTEND_IP/api/users > /dev/null
  echo "Request $i sent"
  sleep 1
done
```

### Step 2: Check Pod Logs

```bash
# Check frontend logs for OTel initialization
kubectl logs -l app=frontend -n otel-3tier --tail=20

# You should see:
# "OpenTelemetry SDK configured with standard OTLP exporter"

# Check for injected environment variables
kubectl exec deployment/frontend -n otel-3tier -- env | grep OTEL

# You should see variables like:
# OTEL_EXPORTER_OTLP_ENDPOINT=http://...
# OTEL_SERVICE_NAME=frontend
```

### Step 3: View Telemetry in Azure Monitor

**Wait 5-10 minutes for telemetry to appear** (ingestion delay is normal)

1. Go to Azure Portal → Your Application Insights resource
2. Click **Application Map** (left sidebar)
   - You should see: `frontend` → `backend` → `postgres`
3. Click **Performance** (left sidebar)
   - You should see requests with durations
4. Click **Logs** and run this query:

```kusto
requests
| where timestamp > ago(30m)
| where cloud_RoleName in ("frontend", "backend")
| summarize count() by cloud_RoleName
| render piechart
```

5. Check distributed traces:

```kusto
requests
| where timestamp > ago(30m)
| where cloud_RoleName == "frontend"
| take 10
| join kind=inner (
    dependencies
    | where timestamp > ago(30m)
) on operation_Id
| project
    timestamp,
    frontend_operation = name,
    backend_dependency = name1,
    frontend_duration = duration,
    dependency_duration = duration1,
    operation_Id
```

## Part 5: Understanding the Setup

### What Changed from Azure Monitor Distro?

**Before (Azure Monitor Distro):**
```javascript
const { useAzureMonitor } = require("@azure/monitor-opentelemetry");

useAzureMonitor({
  azureMonitorExporterOptions: {
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  }
});
```

**After (Standard OpenTelemetry):**
```javascript
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'frontend',
  }),
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### How Autoconfiguration Works

1. **Namespace Annotation**: The `otel-3tier` namespace has:
   ```yaml
   annotations:
     instrumentation.opentelemetry.io/inject-configuration: "true"
   ```

2. **AKS Addon Injection**: The Azure Monitor addon running in `kube-system`:
   - Detects pods in annotated namespaces
   - Injects environment variables into pods:
     - `OTEL_EXPORTER_OTLP_ENDPOINT` → Azure Monitor OTLP ingestion endpoint
     - `OTEL_EXPORTER_OTLP_PROTOCOL` → `http/protobuf`
     - Additional configuration as needed

3. **Application Behavior**: Your OpenTelemetry SDK:
   - Reads the injected `OTEL_EXPORTER_OTLP_ENDPOINT`
   - Configures OTLP HTTP exporter automatically
   - Sends telemetry to Azure Monitor
   - **No code changes needed** - standard OTel just works!

### Key Benefits

✅ **Zero Azure-specific code** - Use standard OpenTelemetry SDK
✅ **Portable** - Same code works with any OTLP backend (Jaeger, Tempo, etc.)
✅ **Clean separation** - Infrastructure handles Azure integration, app handles instrumentation
✅ **Automatic updates** - Azure manages the OTLP endpoint configuration

## Troubleshooting

### Issue: Pods Not Starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n otel-3tier

# Check image pull issues
kubectl get events -n otel-3tier --sort-by='.lastTimestamp'
```

### Issue: No Telemetry in Azure Monitor

**Checklist:**
1. ✅ Preview features registered? (`az feature show ...`)
2. ✅ Application monitoring enabled on cluster?
3. ✅ OTLP Support enabled in Application Insights?
4. ✅ Namespace has autoconfiguration annotation?
5. ✅ Waited 10+ minutes for ingestion?
6. ✅ Generated traffic to the application?

**Verify injection:**
```bash
kubectl exec deployment/frontend -n otel-3tier -- env | grep OTEL_EXPORTER

# Should show:
# OTEL_EXPORTER_OTLP_ENDPOINT=http://...
```

**Check logs:**
```bash
kubectl logs -l app=frontend -n otel-3tier | grep -i error
```

### Issue: Annotation Not Working

If namespace annotation isn't working, try per-deployment annotation:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  annotations:
    instrumentation.opentelemetry.io/inject-configuration: "true"
```

Then restart:
```bash
kubectl rollout restart deployment frontend -n otel-3tier
```

### Issue: Connection Refused Errors

```bash
# Check if OpenTelemetry components are running
kubectl get pods -n kube-system | grep -E 'ama-|otel'

# Check component logs
kubectl logs -n kube-system -l component=ama-logs-otel
```

## Cleanup

```bash
# Delete the application
kubectl delete namespace otel-3tier

# Delete AKS cluster
az aks delete \
  --resource-group $RESOURCE_GROUP \
  --name $CLUSTER_NAME \
  --yes --no-wait

# Delete entire resource group (includes ACR, App Insights, etc.)
az group delete \
  --name $RESOURCE_GROUP \
  --yes --no-wait
```

## Next Steps

- **Add more services**: Follow the same pattern for additional microservices
- **Custom metrics**: Use OpenTelemetry Metrics API to track business KPIs
- **Sampling**: Configure sampling for high-volume services
- **Alerting**: Set up Application Insights alerts on SLOs/SLIs
- **Multi-environment**: Use different namespaces with different App Insights resources

## References

- [Azure Monitor Kubernetes OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol)
- [OpenTelemetry Node.js SDK](https://opentelemetry.io/docs/instrumentation/js/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)

## Support

For issues with:
- **This demo**: Check GitHub issues or create a new one
- **Azure Monitor preview**: Contact Azure Support
- **OpenTelemetry SDK**: Check OpenTelemetry community resources
