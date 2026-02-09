# Azure Monitor Auto-Configuration for AKS: Zero Code, Full OpenTelemetry Observability

## The Problem

You want to use **standard OpenTelemetry** in your Kubernetes applications to avoid vendor lock-in, but you also want the rich observability features of **Azure Application Insights**. Traditionally, this meant either:

1. Using Azure-specific SDKs (vendor lock-in)
2. Setting up complex OpenTelemetry Collectors (operational overhead)
3. Managing custom exporters and configuration (maintenance burden)

**What if I told you there's a third option?**

## Introducing Azure Monitor Auto-Configuration for AKS

Azure Monitor Auto-Configuration is a feature that automatically routes OpenTelemetry telemetry from your **standard, vendor-neutral** OpenTelemetry SDK to Application Insights—**without a single line of Azure-specific code**.

### How It Works

```
Your App (Standard OpenTelemetry SDK)
    ↓
    │ Reads OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    │ from environment (auto-injected)
    ↓
Azure Monitor Agent (AMA) on each node
    ↓
    │ Routes via Data Collection Rule (DCR)
    │ based on namespace configuration
    ↓
Application Insights
```

The magic happens through three components:

1. **Namespace Annotation**: Marks namespaces for auto-configuration
2. **Instrumentation CR**: Points to your Application Insights
3. **Azure Monitor Agent (AMA)**: Already running on your AKS nodes, accepts OTLP and routes to Application Insights

## Why This Is Revolutionary

### Before (Azure Monitor Distro)
```javascript
// ❌ Locked into Azure
const { useAzureMonitor } = require("@azure/monitor-opentelemetry");
useAzureMonitor({ connectionString: "..." });
```

### After (Auto-Configuration)
```javascript
// ✅ Pure OpenTelemetry - works anywhere!
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();  // Done!
```

**No Azure packages. No Azure code. Just standard OpenTelemetry.**

The SDK automatically reads the injected `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` environment variable and sends telemetry to the local Azure Monitor Agent.

## Live Demo: Deploy in 25-30 Minutes

I've created a complete **3-tier application** (Frontend → Backend → PostgreSQL) instrumented with pure OpenTelemetry to demonstrate this feature.

### 🔗 GitHub Repository
**[https://github.com/aritraghosh/otel-aks-autoconfiguration-demo](https://github.com/aritraghosh/otel-aks-autoconfiguration-demo)**

### What's Included

- ✅ Node.js frontend and backend with **latest OpenTelemetry SDK (v0.211.0)**
- ✅ PostgreSQL database
- ✅ Zero Azure dependencies in application code
- ✅ Automated setup scripts
- ✅ Complete documentation

### Prerequisites

Before you begin, you need:

- Azure subscription
- Azure CLI installed and logged in (`az login`)
- `kubectl` and `docker` installed
- `jq` installed (for parsing JSON in scripts)
- ~25-30 minutes of your time

⚠️ **Important**: This feature is currently in **preview**. You need to enable it on your subscription first.

## Step-by-Step Demo

The deployment is organized into **three phases**:

1. **Part 1: Prerequisites & Infrastructure** - Enable preview feature, create AKS with monitoring flag, create Application Insights
2. **Part 2: Deploy Application** - Build images and deploy your OpenTelemetry-instrumented apps
3. **Part 3: Enable Auto-Configuration** - Create Instrumentation resource, enable monitoring, restart workloads

---

## Part 1: Prerequisites & Infrastructure Setup

### Step 1: Enable the Preview Feature (One-time Setup)

⚠️ **Important**: This feature is currently in **preview**. Register it on your subscription:

```bash
# Register the preview feature
az feature register \
  --namespace Microsoft.ContainerService \
  --name AKSAzureMonitorAutoConfiguration

# Wait for registration to complete (takes 2-5 minutes)
# Check status until it shows "Registered"
az feature show \
  --namespace Microsoft.ContainerService \
  --name AKSAzureMonitorAutoConfiguration \
  --query properties.state -o tsv

# Once registered, refresh the provider
az provider register --namespace Microsoft.ContainerService
```

**Wait until the status shows `"Registered"` before proceeding.**

### Step 2: Clone the Repository

```bash
git clone https://github.com/aritraghosh/otel-aks-autoconfiguration-demo
cd otel-aks-autoconfiguration-demo
```

### Step 3: Configure Your Settings

```bash
# Copy the example configuration
cp config.env.example config.env

# Edit with your Azure subscription ID
vi config.env
```

Update these values:
```bash
export SUBSCRIPTION_ID="your-subscription-id"
export RESOURCE_GROUP="otel-demo-rg"
export LOCATION="eastus"
export AKS_CLUSTER_NAME="otel-demo-cluster"
export ACR_NAME="oteldemoacr$(date +%s)"  # Must be unique
export APP_INSIGHTS_NAME="otel-demo-insights"
export NAMESPACE="otel-demo"
```

### Step 4: Create Azure Infrastructure

This step creates the foundational resources needed for auto-configuration.

#### 4a. Create Resource Group, ACR, and AKS Cluster

```bash
# Set your subscription
az account set --subscription $SUBSCRIPTION_ID

# Create resource group
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION

# Create Azure Container Registry
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic

# Create AKS cluster with monitoring flag
az aks create \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME \
  --node-count 2 \
  --node-vm-size Standard_DS2_v2 \
  --enable-managed-identity \
  --attach-acr $ACR_NAME \
  --enable-azure-monitor-app-monitoring \
  --generate-ssh-keys
```

**Critical**: The `--enable-azure-monitor-app-monitoring` flag is **required** for auto-configuration. It:
- Deploys Azure Monitor Agent (AMA) as a DaemonSet on each node
- Configures AMA to listen on OTLP endpoints (ports 28331 for traces/logs, 28333 for metrics)
- Sets up Data Collection Rules (DCR) infrastructure for routing telemetry
- Enables environment variable injection for OpenTelemetry

**Already have an AKS cluster?** Enable monitoring on existing cluster:
```bash
az aks update \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME \
  --enable-azure-monitor-app-monitoring
```

Get credentials:
```bash
az aks get-credentials \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME \
  --overwrite-existing
```

#### 4b. Create Application Insights with OTLP Support

⚠️ **Important**: Application Insights must be created with OTLP support to accept OpenTelemetry data.

```bash
# Create Application Insights
az monitor app-insights component create \
  --app $APP_INSIGHTS_NAME \
  --location $LOCATION \
  --resource-group $RESOURCE_GROUP \
  --application-type web
```

**What this creates:**
- ✅ Application Insights resource with **OTLP ingestion enabled by default** (when created via CLI or portal)
- ✅ Workspace-based Application Insights (modern architecture)
- ✅ Endpoints for receiving OTLP data from Azure Monitor Agent

**Get the connection string** (you'll need this in Part 3):
```bash
APP_INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
  --app $APP_INSIGHTS_NAME \
  --resource-group $RESOURCE_GROUP \
  --query connectionString -o tsv)

echo $APP_INSIGHTS_CONNECTION_STRING
```

**Connection string format:**
```
InstrumentationKey=11111111-1111-1111-1111-111111111111;
IngestionEndpoint=https://eastus2-3.in.applicationinsights.azure.com/;
LiveEndpoint=https://eastus2.livediagnostics.monitor.azure.com/
```

**Key components:**
- `InstrumentationKey`: Unique identifier for your Application Insights resource
- `IngestionEndpoint`: Where telemetry data is sent (region-specific)
- `LiveEndpoint`: For Live Metrics Stream

**Verify OTLP support:**
```bash
# Check that the resource was created
az monitor app-insights component show \
  --app $APP_INSIGHTS_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "{name:name, location:location, kind:kind, connectionString:connectionString}" \
  --output table
```

**Reference**: [Microsoft Docs - Create Application Insights with OTLP Support](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol#3-create-an-application-insights-resource-with-otlp-support)

**Time for all infrastructure: ~10-12 minutes**

**💡 Automated option:** The repository includes `./scripts/setup.sh` that does all of steps 4a and 4b automatically.

---

## Part 2: Deploy Your Application

### Step 5: Build and Push Docker Images

```bash
./scripts/build-and-push.sh
```

**What it does:**
- ✅ Builds frontend and backend images with OpenTelemetry SDK
- ✅ Pushes to your ACR
- ✅ Tags with your ACR name

**Time: ~5 minutes**

### Step 6: Deploy Applications to AKS

```bash
./scripts/deploy.sh
```

**What it deploys:**
- ✅ Frontend (Express.js with OpenTelemetry SDK v0.211.0)
- ✅ Backend (Express.js + PostgreSQL with OpenTelemetry SDK v0.211.0)
- ✅ PostgreSQL database
- ✅ LoadBalancer service

**Time: ~3 minutes**

### Step 7: Verify Application is Running

```bash
# Check pods are running
kubectl get pods -n otel-demo

# Get frontend URL
kubectl get svc frontend -n otel-demo
```

**At this point, your application is running but NOT yet sending telemetry to Application Insights.** The OpenTelemetry SDK needs configuration, which we'll enable in Part 3.

---

## Part 3: Enable Auto-Configuration

### Step 8: Create Namespace Annotation

Annotate the namespace to enable auto-configuration:

```bash
kubectl annotate namespace otel-demo \
  instrumentation.opentelemetry.io/inject-configuration="true" \
  --overwrite
```

This tells AKS to inject OpenTelemetry configuration into pods in this namespace.

### Step 9: Create Instrumentation Resource

This is the **critical step** that connects your apps to Application Insights.

First, get your Application Insights connection string:

```bash
APP_INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
  --app otel-demo-insights \
  --resource-group otel-demo-rg \
  --query connectionString -o tsv)

echo $APP_INSIGHTS_CONNECTION_STRING
# Output: InstrumentationKey=11111111-1111-1111-1111-111111111111;IngestionEndpoint=https://eastus2-3.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus2.livediagnostics.monitor.azure.com/
```

Create the Instrumentation custom resource:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: monitor.azure.com/v1
kind: Instrumentation
metadata:
  name: default
  namespace: otel-demo
spec:
  destination:
    applicationInsightsConnectionString: "$APP_INSIGHTS_CONNECTION_STRING"
  settings:
    autoInstrumentationPlatforms: []
EOF
```

**Key components explained:**
- `destination.applicationInsightsConnectionString`: **Required**. Full connection string including InstrumentationKey, IngestionEndpoint, and LiveEndpoint
- `autoInstrumentationPlatforms: []`: **Empty array** because apps are already instrumented with OpenTelemetry SDK
  - If you wanted AKS to auto-inject instrumentation, you'd specify languages here (e.g., `["java", "python"]`)
  - For pre-instrumented apps (our case), keep it empty

**Reference**: [Microsoft Docs - Auto-configuration for OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol#autoconfiguration-apps-already-instrumented-with-opentelemetry-sdks)

### Step 10: Restart Azure Monitor Agent Pods

AMA pods need to restart to pick up the new Instrumentation CR:

```bash
# Restart AMA pods
kubectl delete pods -n kube-system -l rsName=ama-logs

# Wait for pods to be ready
kubectl wait --for=condition=ready pod -l rsName=ama-logs -n kube-system --timeout=120s
```

### Step 11: Restart Your Application Workloads

Your application pods need to restart to get the injected OpenTelemetry environment variables:

```bash
# Restart application pods
kubectl rollout restart deployment/frontend -n otel-demo
kubectl rollout restart deployment/backend -n otel-demo

# Wait for rollout to complete
kubectl rollout status deployment/frontend -n otel-demo
kubectl rollout status deployment/backend -n otel-demo
```

### Step 12: Verify Environment Variables are Injected

Check that OpenTelemetry configuration was injected:

```bash
kubectl exec -n otel-demo deployment/frontend -- env | grep OTEL_

# You should see:
# OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://10.224.0.5:28331/v1/traces
# OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://10.224.0.5:28333/v1/metrics
# OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://10.224.0.5:28331/v1/logs
# OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
# OTEL_RESOURCE_ATTRIBUTES=service.namespace=otel-demo,...
```

---

## Test and View Telemetry

### Step 13: Generate Traffic

Get the frontend URL and make some requests:

```bash
# Get the LoadBalancer IP
FRONTEND_IP=$(kubectl get svc frontend -n otel-demo -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Generate traffic
curl http://$FRONTEND_IP/api/users
curl http://$FRONTEND_IP/api/stats
curl http://$FRONTEND_IP/api/users/1
```

### Step 14: View Telemetry in Application Insights

**Wait 3-5 minutes for data ingestion**, then:

#### Option 1: Azure Portal

1. Go to Azure Portal → Your Application Insights resource
2. Click **"Application map"** to see service topology
3. Click **"Transaction search"** to see distributed traces

#### Option 2: Azure CLI

```bash
# Get your Application Insights ID
APP_INSIGHTS_ID=$(az monitor app-insights component show \
  --app otel-demo-insights \
  --resource-group otel-demo-rg \
  --query id -o tsv)

# Query recent requests
az monitor app-insights query \
  --app $APP_INSIGHTS_ID \
  --analytics-query "requests | where timestamp > ago(10m) | summarize count() by cloud_RoleName, name" \
  --output table
```

**You should see:**
```
CloudRoleName              Name                Count
-------------------------  ------------------  -----
[otel-demo]/frontend       GET /api/users      15
[otel-demo]/frontend       GET /api/stats      8
[otel-demo]/backend        GET /users          15
[otel-demo]/backend        GET /stats          8
```

---

## What You Just Deployed

### The Application Code

Here's the **complete** OpenTelemetry configuration in the frontend:

```javascript
// frontend/server.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// That's it! Your Express app is now fully instrumented
const express = require('express');
const app = express();

app.get('/api/users', async (req, res) => {
  const response = await axios.get(`${BACKEND_URL}/users`);
  res.json(response.data);
});

app.listen(8080);
```

**Dependencies** (from `package.json`):
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "@opentelemetry/sdk-node": "^0.211.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/auto-instrumentations-node": "^0.52.0"
  }
}
```

**Zero Azure packages. Zero Azure code.**

### The Auto-Configuration Magic

Behind the scenes, these environment variables are automatically injected into your pods:

```bash
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://10.224.0.5:28331/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://10.224.0.5:28333/v1/metrics
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://10.224.0.5:28331/v1/logs
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
OTEL_RESOURCE_ATTRIBUTES=service.namespace=otel-demo,...,microsoft.applicationId=abc-123
```

These variables tell your OpenTelemetry SDK:
- Where to send telemetry (Azure Monitor Agent on the node)
- What protocol to use (OTLP/HTTP with binary Protobuf)
- Which Application Insights instance to route to (`microsoft.applicationId`)

### How Auto-Configuration Was Set Up

Auto-configuration for apps already instrumented with OpenTelemetry requires **two key Kubernetes resources**:

#### 1. Namespace Annotation
This tells AKS to enable auto-configuration for all pods in this namespace:

```bash
kubectl annotate namespace otel-demo \
  instrumentation.opentelemetry.io/inject-configuration="true"
```

#### 2. Instrumentation Custom Resource (CR)
This is the **critical piece** that connects your OpenTelemetry-instrumented apps to Application Insights:

```yaml
apiVersion: monitor.azure.com/v1
kind: Instrumentation
metadata:
  name: default
  namespace: otel-demo
spec:
  destination:  # Required
    applicationInsightsConnectionString: "InstrumentationKey=11111111-1111-1111-1111-111111111111;IngestionEndpoint=https://eastus2-3.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus2.livediagnostics.monitor.azure.com/"
  settings:
    autoInstrumentationPlatforms: []  # Empty = apps already have OpenTelemetry SDK
```

**Key points about the Instrumentation CR:**
- `destination`: **Required section** that specifies where telemetry goes
- `applicationInsightsConnectionString`: **Required**. Must include InstrumentationKey, IngestionEndpoint, and LiveEndpoint
- `autoInstrumentationPlatforms: []`: **Empty array** because your apps are already instrumented with OpenTelemetry SDK
  - If you wanted AKS to auto-inject instrumentation, you'd specify languages here (e.g., `["java", "python"]`)
  - For pre-instrumented apps (our case), keep it empty

**What happens when you create this?**
1. Azure Monitor Agent (AMA) reads the Instrumentation CR
2. AMA injects environment variables into pods in the annotated namespace
3. Your OpenTelemetry SDK reads these variables automatically
4. Telemetry flows from SDK → AMA → Application Insights (via Data Collection Rule)

**Reference**: [Microsoft Docs - Auto-configuration for OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol#autoconfiguration-apps-already-instrumented-with-opentelemetry-sdks)

That's all the Azure-specific configuration needed!

## What You Get in Application Insights

### 1. Distributed Tracing

See complete request flows:
```
GET /api/users (frontend)
  → GET /users (backend)
    → SELECT * FROM users (PostgreSQL)
```

Every span includes:
- Operation name
- Duration
- HTTP status code
- Custom attributes

### 2. Application Map

Visual service topology:
```
[otel-demo]/frontend ──HTTP──▶ [otel-demo]/backend ──SQL──▶ PostgreSQL
```

Click any node to see:
- Request rates
- Failure rates
- Average duration

### 3. Performance Monitoring

Query with KQL:
```kusto
// Find slow requests
requests
| where timestamp > ago(1h)
| where duration > 1000
| project timestamp, name, duration, cloud_RoleName
| order by duration desc

// Analyze dependency performance
dependencies
| where timestamp > ago(1h)
| summarize avg(duration), count() by target, name
| order by avg_duration desc
```

### 4. Transaction Search

Search across all telemetry:
- Filter by service, operation, status code
- See full distributed trace for any request
- Jump from logs to traces to metrics

## Key Technical Details

### Why Latest SDK Version Matters

⚠️ **Critical**: You must use OpenTelemetry SDK **v0.211.0 or later**

Older versions (like v0.45.0) have compatibility issues with Azure Monitor's OTLP ingestion and will result in **400 Bad Request errors**.

The demo repository uses the latest versions that are known to work.

### Protocol Requirements

Azure Monitor Auto-Configuration requires:
- ✅ OTLP/HTTP with binary Protobuf
- ❌ OTLP/gRPC (not supported)
- ❌ JSON payloads (not supported)
- ❌ Compression (not supported)

The standard OpenTelemetry SDK auto-configures correctly when it reads the injected environment variables.

### Important: Restart AMA Pods

After creating the Instrumentation CR, restart the Azure Monitor Agent pods so they pick up the new configuration:

```bash
kubectl delete pods -n kube-system -l rsName=ama-logs
```

The demo scripts do this automatically.

## Troubleshooting

### No Data in Application Insights?

**Check 1:** Verify environment variables are injected
```bash
kubectl exec -n otel-demo deployment/frontend -- env | grep OTEL_EXPORTER
```

**Check 2:** Check for errors in logs
```bash
kubectl logs -n otel-demo deployment/frontend | grep -i error
```

**Check 3:** Verify AMA pods are running
```bash
kubectl get pods -n kube-system | grep ama
```

**Check 4:** Restart AMA pods
```bash
kubectl delete pods -n kube-system -l rsName=ama-logs
```

See the complete troubleshooting guide in the [repository documentation](https://github.com/aritraghosh/otel-aks-autoconfiguration-demo/blob/main/simple-3tier/SETUP.md).

## Cost Estimate

Running this demo costs approximately:

| Resource | Cost |
|----------|------|
| AKS (2 x Standard_DS2_v2 nodes) | ~$140/month |
| Azure Container Registry (Basic) | ~$5/month |
| Application Insights (2-3 GB) | Free (first 5GB free) |
| **Total** | **~$145/month** |

💡 **Save money**: Run the cleanup script when you're done:
```bash
./scripts/cleanup.sh
```

## Comparison: Before vs After

| Aspect | Azure Monitor Distro | Auto-Configuration |
|--------|---------------------|-------------------|
| **Code** | Azure-specific SDK | Pure OpenTelemetry |
| **Dependencies** | `@azure/monitor-opentelemetry` | Standard `@opentelemetry/*` |
| **Portability** | Azure only | Any OTLP backend |
| **Configuration** | In application code | Kubernetes resources |
| **Migration effort** | Rewrite instrumentation | Update SDK versions |
| **Vendor lock-in** | High | Zero |

## Why This Matters

### For Development Teams

- ✅ Use the same observability code in dev, staging, and production
- ✅ Switch backends without code changes
- ✅ Leverage OpenTelemetry community ecosystem
- ✅ Future-proof your instrumentation

### For Platform Teams

- ✅ Centralized configuration via Kubernetes
- ✅ No application changes needed
- ✅ Consistent observability across all apps
- ✅ Easy to onboard new services

### For Organizations

- ✅ Avoid vendor lock-in
- ✅ Standardize on open standards
- ✅ Flexibility to change vendors
- ✅ Invest in portable observability

## Try It Now!

**🔗 Complete Demo Repository**: [github.com/aritraghosh/otel-aks-autoconfiguration-demo](https://github.com/aritraghosh/otel-aks-autoconfiguration-demo)

The repository includes:
- ✅ Working 3-tier application
- ✅ Automated setup scripts (3 commands to deploy)
- ✅ Detailed documentation
- ✅ Troubleshooting guide
- ✅ Configurable for your Azure subscription

**Time to deploy**: ~25-30 minutes
**Lines of Azure code**: 0
**Vendor lock-in**: None

```bash
# Get started in 3 commands:
git clone https://github.com/aritraghosh/otel-aks-autoconfiguration-demo
cd otel-aks-autoconfiguration-demo
./scripts/setup.sh && ./scripts/build-and-push.sh && ./scripts/deploy.sh
```

## What's Next?

Now that you have auto-configuration working, you can:

1. **Add custom spans** - Instrument business logic with custom spans
2. **Add custom metrics** - Track business KPIs
3. **Implement sampling** - Reduce costs for high-volume endpoints
4. **Try other languages** - Python, Java, .NET all support this approach
5. **Multi-cluster setup** - Deploy across multiple AKS clusters

## Conclusion

Azure Monitor Auto-Configuration for AKS eliminates the trade-off between using standard OpenTelemetry and getting rich Azure observability. You get:

- ✅ **Pure OpenTelemetry** - No vendor-specific code
- ✅ **Automatic routing** - Zero configuration in your app
- ✅ **Full Application Insights** - Distributed tracing, metrics, logs
- ✅ **Future-proof** - Switch backends anytime

The best part? **It takes 25-30 minutes to see it working** with the demo repository.

---

## Resources

- **Demo Repository**: [github.com/aritraghosh/otel-aks-autoconfiguration-demo](https://github.com/aritraghosh/otel-aks-autoconfiguration-demo)
- **Azure Documentation**: [OpenTelemetry Auto-Configuration for AKS](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol)
- **OpenTelemetry**: [opentelemetry.io](https://opentelemetry.io)

---

*Found this helpful? ⭐ Star the [repository](https://github.com/aritraghosh/otel-aks-autoconfiguration-demo) and share with your team!*

*Questions? Drop a comment below or open an issue on GitHub.*

---

## About the Author

[Your bio and contact information]
