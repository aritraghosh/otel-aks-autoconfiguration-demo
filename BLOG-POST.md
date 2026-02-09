# OpenTelemetry Auto-Configuration for Azure Kubernetes Service: A Complete Guide

## Introduction

Observability is crucial for modern cloud-native applications, but instrumenting your applications traditionally requires either vendor-specific SDKs or complex OpenTelemetry collector configurations. Azure Monitor has introduced **Auto-Configuration for AKS**, a game-changing feature that enables you to use standard OpenTelemetry SDKs while automatically routing telemetry to Application Insights—no Azure-specific code required.

In this post, I'll walk you through setting up a complete 3-tier Node.js application with OpenTelemetry instrumentation that automatically sends telemetry to Azure Application Insights using nothing but standard OpenTelemetry libraries.

## What is OpenTelemetry Auto-Configuration for AKS?

Azure Monitor Auto-Configuration is a feature that:

1. **Injects OTLP endpoints** into your pod environment variables
2. **Routes telemetry** from your standard OpenTelemetry SDK to Application Insights
3. **Requires zero Azure-specific code** in your applications
4. **Enables vendor portability** - your code works anywhere OpenTelemetry is supported

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Your Application Code                         │
│              (Standard OpenTelemetry SDK)                        │
│                                                                   │
│  const { NodeSDK } = require('@opentelemetry/sdk-node');        │
│  const sdk = new NodeSDK({ ... });                              │
│  sdk.start();                                                    │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       │ OTLP/HTTP (Binary Protobuf)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│            Azure Monitor Agent (AMA) - DaemonSet                 │
│  • Receives OTLP on localhost:28331 (traces/logs)               │
│  • Receives OTLP on localhost:28333 (metrics)                   │
│  • Routes to correct Application Insights via DCR               │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       │ Via Data Collection Rule (DCR)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Application Insights                          │
│  • Distributed tracing                                           │
│  • Performance monitoring                                        │
│  • Application map                                               │
│  • Log analytics                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## The Demo Application

I've created a 3-tier application to demonstrate this setup:

- **Frontend**: Node.js/Express web server with UI
- **Backend**: Node.js/Express API server
- **Database**: PostgreSQL for data persistence

**Key feature**: Both frontend and backend use **100% standard OpenTelemetry SDK** with **zero Azure-specific dependencies**.

## Why This Matters

### Traditional Approach (Azure Monitor Distro)
```javascript
// ❌ Azure-specific code - locks you in
const { useAzureMonitor } = require("@azure/monitor-opentelemetry");

useAzureMonitor({
  azureMonitorExporterOptions: {
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  }
});
```

### Auto-Configuration Approach
```javascript
// ✅ Pure OpenTelemetry - portable anywhere
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();  // That's it!
```

The SDK automatically picks up Azure Monitor endpoints from environment variables injected by the auto-configuration feature.

## Setting Up Auto-Configuration

### Step 1: Enable Azure Monitor on AKS

When creating your AKS cluster, enable Azure Monitor metrics:

```bash
az aks create \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER_NAME \
  --enable-azure-monitor-metrics \
  ...
```

This installs the **Azure Monitor Agent (AMA)** DaemonSet, which provides the OTLP endpoints.

### Step 2: Configure Your Namespace

Add the auto-configuration annotation to your namespace:

```bash
kubectl create namespace otel-demo

kubectl annotate namespace otel-demo \
  instrumentation.opentelemetry.io/inject-configuration="true"
```

### Step 3: Create Instrumentation Resource

Create a custom resource pointing to your Application Insights:

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

That's it! Any pod deployed to this namespace will automatically get:
- OTLP endpoint environment variables
- Resource attributes including `microsoft.applicationId`
- Automatic routing to your Application Insights instance

## The Application Code

Here's the complete OpenTelemetry setup for the Node.js frontend:

```javascript
// frontend/server.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

// Minimal configuration - SDK auto-configures from environment variables
const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {},
      '@opentelemetry/instrumentation-express': {},
    }),
  ],
});

sdk.start();

// Now your Express app is fully instrumented
const express = require('express');
const app = express();

app.get('/api/users', async (req, res) => {
  // This HTTP call is automatically traced
  const response = await axios.get(`${BACKEND_URL}/users`);
  res.json(response.data);
});

app.listen(8080);
```

**What's happening here:**

1. The NodeSDK reads `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` from environment (injected by auto-config)
2. Auto-instrumentations capture HTTP requests, database queries, etc.
3. Telemetry is automatically exported to the AMA endpoint
4. AMA routes it to Application Insights based on the namespace configuration

## Key Requirements & Gotchas

Through extensive testing, I discovered several critical requirements:

### ✅ Use Latest SDK Versions

```json
{
  "dependencies": {
    "@opentelemetry/sdk-node": "^0.211.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/auto-instrumentations-node": "^0.52.0"
  }
}
```

**Why**: Older versions (like 0.45.0) have compatibility issues with Azure Monitor's OTLP ingestion pipeline and will result in 400 errors.

### ✅ Use Minimal Configuration

Let the SDK auto-configure from environment variables. Don't override with explicit exporters:

```javascript
// ❌ DON'T do this - causes conflicts
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  compression: 'none',
});

// ✅ DO this - let SDK auto-configure
const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});
```

### ✅ Restart AMA Pods After Configuration

After creating the Instrumentation CR, restart the AMA pods so they pick up the new namespace-specific routing:

```bash
kubectl delete pods -n kube-system -l rsName=ama-logs
```

### ✅ Important Limitations

- **Protocol**: OTLP/HTTP with binary Protobuf **only**
  - ❌ OTLP/gRPC not supported
  - ❌ JSON payloads not supported
- **Compression**: Not supported (ensure SDK doesn't compress)
- **HTTPS**: Plain HTTP only (HTTPS endpoints not supported)
- **Istio mTLS**: Namespaces with Istio mTLS are not supported

## What You Get in Application Insights

Once telemetry is flowing, you'll see:

### 1. Distributed Tracing
- Complete request traces from frontend → backend → database
- Timing breakdown for each operation
- Correlation across services

### 2. Application Map
```
[otel-demo]/frontend ──▶ [otel-demo]/backend ──▶ PostgreSQL
     HTTP                     HTTP                    SQL
```

### 3. Performance Monitoring
- Request rates and latencies
- Dependency call durations
- Database query performance
- Custom metrics

### 4. Logs and Traces Correlation
- Application logs automatically correlated with traces
- Search across all telemetry dimensions

## Querying Your Telemetry

You can query Application Insights using KQL (Kusto Query Language):

```kusto
// View recent requests by service
requests
| where timestamp > ago(10m)
| summarize count() by cloud_RoleName, name
| order by count_ desc

// Find slow requests
requests
| where timestamp > ago(1h) and duration > 1000
| project timestamp, name, duration, cloud_RoleName
| order by duration desc

// Trace a specific request end-to-end
dependencies
| where operation_Id == "specific-trace-id"
| union (requests | where operation_Id == "specific-trace-id")
| project timestamp, type, name, target, duration
| order by timestamp asc
```

Or via Azure CLI:

```bash
az monitor app-insights query \
  --app $APP_INSIGHTS_ID \
  --analytics-query "requests | where timestamp > ago(10m) | summarize count() by cloud_RoleName"
```

## Verification Timeline

After deploying, here's what to expect:

**Immediately:**
- ✅ Pods start successfully
- ✅ No error logs about OTLP export
- ✅ Environment variables injected correctly

**After 3-5 minutes:**
- ✅ Data appears in Application Insights
- ✅ Application map shows service topology
- ✅ Distributed traces visible

## Try It Yourself

I've published the complete demo with full setup instructions:

**🔗 GitHub Repository**: [github.com/your-repo/otel-aks-demo](https://github.com/your-repo/otel-aks-demo)

The repository includes:
- Complete source code for all 3 tiers
- Kubernetes manifests
- Automated setup scripts
- Troubleshooting guide
- Configuration for your own Azure resources

**Quick Start:**
```bash
git clone https://github.com/your-repo/otel-aks-demo
cd otel-aks-demo/simple-3tier

# Set your Azure configuration
vi config.env

# Run automated setup
./scripts/setup.sh

# Deploy applications
./scripts/deploy.sh
```

Full setup guide: [SETUP.md](https://github.com/your-repo/otel-aks-demo/blob/main/simple-3tier/SETUP.md)

## Comparison: Before and After

### Migration Effort

| Aspect | Azure Monitor Distro | Auto-Configuration |
|--------|---------------------|-------------------|
| Code changes | Replace entire SDK | Update versions only |
| Azure dependencies | `@azure/monitor-opentelemetry` | None |
| Configuration | Connection string in code | K8s annotation |
| Portability | Azure only | Any OpenTelemetry backend |
| Setup time | ~1 hour | ~15 minutes |

### Performance Impact

Both approaches have similar performance characteristics:
- ~1-2% CPU overhead for instrumentation
- ~50-100 MB memory per instrumented service
- ~3-5 minute data ingestion latency

## Troubleshooting Common Issues

### Issue: No data in Application Insights

**Solution 1**: Check environment variables are injected
```bash
kubectl exec deployment/frontend -- env | grep OTEL_EXPORTER
```

**Solution 2**: Restart AMA pods
```bash
kubectl delete pods -n kube-system -l rsName=ama-logs
```

**Solution 3**: Verify SDK version (must be 0.211.0+)

### Issue: 400 Bad Request errors in logs

This means SDK version incompatibility. Update to:
- `@opentelemetry/sdk-node`: `^0.211.0`
- `@opentelemetry/api`: `^1.9.0`

### Issue: Partial traces (missing spans)

Check that all services are properly instrumented and auto-instrumentation is loaded before your application code.

## Cost Considerations

Enabling auto-configuration has minimal additional costs:
- **AMA DaemonSet**: Included with AKS (no extra cost)
- **Application Insights**: Pay-per-GB ingested (first 5GB free/month)
- **Data Collection Rules**: No additional charge

Typical small application costs:
- ~2-3 GB telemetry/month = Free
- Medium application: ~10 GB/month = ~$2.30/month
- Large application: ~100 GB/month = ~$23/month

## Best Practices

1. **Use semantic conventions**: Follow OpenTelemetry semantic conventions for consistent telemetry
2. **Add custom attributes**: Enrich spans with business context
3. **Sample high-volume endpoints**: Use sampling for health checks to reduce costs
4. **Monitor your costs**: Set up budget alerts in Azure
5. **Test locally first**: Use OTLP collectors locally before deploying to AKS

## Conclusion

Azure Monitor Auto-Configuration for AKS removes the barrier between using standard OpenTelemetry and getting telemetry into Application Insights. You get:

- ✅ **Zero vendor lock-in**: Pure OpenTelemetry code
- ✅ **Zero Azure dependencies**: No Azure-specific packages
- ✅ **Zero configuration**: Automatic OTLP routing
- ✅ **Full observability**: Distributed tracing, metrics, and logs

This approach future-proofs your observability strategy while giving you the full power of Application Insights today.

## Resources

- **Demo Repository**: [github.com/your-repo/otel-aks-demo](https://github.com/your-repo/otel-aks-demo)
- **Setup Guide**: [SETUP.md](./SETUP.md)
- **Azure Monitor Documentation**: [Azure Monitor OpenTelemetry for AKS](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol)
- **OpenTelemetry**: [opentelemetry.io](https://opentelemetry.io)

## What's Next?

In future posts, I'll cover:
- Adding custom spans and metrics
- Implementing sampling strategies
- Multi-cluster observability
- Integrating with Azure Managed Grafana
- Using OpenTelemetry with Python and Java services

---

*Have questions or run into issues? Drop a comment below or open an issue on the [GitHub repository](https://github.com/your-repo/otel-aks-demo)!*

---

## About the Author

[Your bio and social links]
