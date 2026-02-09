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

## Live Demo: Deploy in 20 Minutes

I've created a complete **3-tier application** (Frontend → Backend → PostgreSQL) instrumented with pure OpenTelemetry to demonstrate this feature.

### 🔗 GitHub Repository
**[https://github.com/YOUR-USERNAME/otel-aks-demo](https://github.com/YOUR-USERNAME/otel-aks-demo)**

### What's Included

- ✅ Node.js frontend and backend with **latest OpenTelemetry SDK (v0.211.0)**
- ✅ PostgreSQL database
- ✅ Zero Azure dependencies in application code
- ✅ Automated setup scripts
- ✅ Complete documentation

### Prerequisites

- Azure subscription
- Azure CLI installed
- `kubectl` and `docker` installed
- ~20 minutes of your time

## Step-by-Step Demo

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR-USERNAME/otel-aks-demo
cd otel-aks-demo/simple-3tier
```

### 2. Configure Your Azure Settings

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

### 3. Run the Automated Setup

This script creates all Azure resources and configures auto-configuration:

```bash
./scripts/setup.sh
```

**What it does (automatically):**
- ✅ Creates AKS cluster with Azure Monitor enabled
- ✅ Creates Azure Container Registry (ACR)
- ✅ Creates Application Insights
- ✅ Configures namespace with auto-configuration annotation
- ✅ Creates Instrumentation custom resource

**Time: ~10 minutes**

### 4. Build and Push Docker Images

```bash
./scripts/build-and-push.sh
```

**What it does:**
- ✅ Builds frontend and backend images
- ✅ Pushes to your ACR
- ✅ Tags with your ACR name

**Time: ~5 minutes**

### 5. Deploy the Application

```bash
./scripts/deploy.sh
```

**What it does:**
- ✅ Deploys frontend, backend, and PostgreSQL
- ✅ Creates LoadBalancer service
- ✅ Waits for pods to be ready

**Time: ~3 minutes**

### 6. Test the Application

Get the frontend URL:
```bash
kubectl get svc frontend -n otel-demo
```

Generate some traffic:
```bash
FRONTEND_IP=$(kubectl get svc frontend -n otel-demo -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Make requests
curl http://$FRONTEND_IP/api/users
curl http://$FRONTEND_IP/api/stats
curl http://$FRONTEND_IP/api/users/1
```

### 7. View Telemetry in Application Insights

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

Two simple Kubernetes resources enable all of this:

**1. Namespace annotation:**
```bash
kubectl annotate namespace otel-demo \
  instrumentation.opentelemetry.io/inject-configuration="true"
```

**2. Instrumentation custom resource:**
```yaml
apiVersion: monitor.azure.com/v1
kind: Instrumentation
metadata:
  name: default
  namespace: otel-demo
spec:
  destination:
    applicationInsightsConnectionString: "InstrumentationKey=...;IngestionEndpoint=..."
  settings:
    autoInstrumentationPlatforms: []
```

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

See the complete troubleshooting guide in the [repository documentation](https://github.com/YOUR-USERNAME/otel-aks-demo/blob/main/simple-3tier/SETUP.md).

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

**🔗 Complete Demo Repository**: [github.com/YOUR-USERNAME/otel-aks-demo](https://github.com/YOUR-USERNAME/otel-aks-demo)

The repository includes:
- ✅ Working 3-tier application
- ✅ Automated setup scripts (3 commands to deploy)
- ✅ Detailed documentation
- ✅ Troubleshooting guide
- ✅ Configurable for your Azure subscription

**Time to deploy**: ~20 minutes
**Lines of Azure code**: 0
**Vendor lock-in**: None

```bash
# Get started in 3 commands:
git clone https://github.com/YOUR-USERNAME/otel-aks-demo
cd otel-aks-demo/simple-3tier
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

The best part? **It takes 20 minutes to see it working** with the demo repository.

---

## Resources

- **Demo Repository**: [github.com/YOUR-USERNAME/otel-aks-demo](https://github.com/YOUR-USERNAME/otel-aks-demo)
- **Azure Documentation**: [OpenTelemetry Auto-Configuration for AKS](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol)
- **OpenTelemetry**: [opentelemetry.io](https://opentelemetry.io)

---

*Found this helpful? ⭐ Star the [repository](https://github.com/YOUR-USERNAME/otel-aks-demo) and share with your team!*

*Questions? Drop a comment below or open an issue on GitHub.*

---

## About the Author

[Your bio and contact information]
