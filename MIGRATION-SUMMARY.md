# Migration Summary: Azure Monitor Distro → Standard OpenTelemetry + Autoconfiguration

## What Changed

This refactoring migrates the `simple-3tier` demo from using Azure Monitor's proprietary OpenTelemetry distro to using standard OpenTelemetry SDK with Azure Monitor's **Autoconfiguration** feature.

## Changes Made

### 1. Frontend Code (`simple-3tier/frontend/server.js`)

**Removed:**
```javascript
const { useAzureMonitor } = require("@azure/monitor-opentelemetry");

useAzureMonitor({
  azureMonitorExporterOptions: {
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  }
});
```

**Added:**
```javascript
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'frontend',
  }),
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### 2. Backend Code (`simple-3tier/backend/server.js`)

**Same pattern as frontend** - replaced Azure Monitor distro with standard OpenTelemetry SDK.

### 3. Dependencies (`package.json` for both services)

**Removed:**
- `@azure/monitor-opentelemetry`

**Added:**
- `@opentelemetry/sdk-node` - Core Node.js SDK
- `@opentelemetry/exporter-trace-otlp-http` - Standard OTLP HTTP exporter
- `@opentelemetry/resources` - Resource semantic conventions
- `@opentelemetry/semantic-conventions` - Standard semantic conventions
- `@opentelemetry/auto-instrumentations-node` - Automatic instrumentation

**Kept:**
- `@opentelemetry/api` - Already present for manual spans

### 4. Kubernetes Deployment (`simple-3tier/k8s/deployment.yaml`)

**Namespace - Added Annotation:**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: otel-3tier
  annotations:
    instrumentation.opentelemetry.io/inject-configuration: "true"
```

**Deployments - Removed:**
- Entire `azure-monitor-secret` Secret resource
- `APPLICATIONINSIGHTS_CONNECTION_STRING` environment variable from both deployments

**Deployments - Added Comment:**
```yaml
# Note: OTEL_EXPORTER_OTLP_ENDPOINT will be injected by AKS Autoconfiguration
```

**Kept:**
- `OTEL_SERVICE_NAME` environment variable
- `OTEL_RESOURCE_ATTRIBUTES` environment variable

## Key Differences

### Before (Azure Monitor Distro)

| Aspect | Implementation |
|--------|----------------|
| **Package** | `@azure/monitor-opentelemetry` |
| **Setup** | `useAzureMonitor()` function |
| **Configuration** | Connection string in env var |
| **Exporter** | Azure-specific (hidden) |
| **Portability** | Tied to Azure Monitor |
| **K8s Config** | Manual connection string secret |

### After (Standard OTel + Autoconfiguration)

| Aspect | Implementation |
|--------|----------------|
| **Package** | Standard OTel SDK packages |
| **Setup** | `NodeSDK` with explicit config |
| **Configuration** | Injected by AKS addon |
| **Exporter** | Standard OTLP HTTP |
| **Portability** | Works with any OTLP backend |
| **K8s Config** | Namespace annotation only |

## Benefits of This Approach

### 1. **Zero Azure-Specific Code**
Your application code uses **only** standard OpenTelemetry APIs and SDKs. Nothing Azure-specific in the codebase.

### 2. **True Portability**
The same code works with:
- Azure Monitor (via Autoconfiguration)
- Jaeger (change `OTEL_EXPORTER_OTLP_ENDPOINT`)
- Tempo (change `OTEL_EXPORTER_OTLP_ENDPOINT`)
- Any OTLP-compatible backend

### 3. **Infrastructure-Managed Configuration**
The AKS addon injects the OTLP endpoint configuration. Your app just needs to know "export via OTLP" - where to export is infrastructure's concern.

### 4. **Clean Separation of Concerns**
```
┌─────────────────────────────────────┐
│  Application Layer                  │
│  - Standard OTel instrumentation    │
│  - OTLP export                      │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  Infrastructure Layer (AKS)         │
│  - Autoconfiguration addon          │
│  - Injects OTLP endpoint            │
│  - Routes to Azure Monitor          │
└─────────────────────────────────────┘
```

### 5. **Follows OpenTelemetry Best Practices**
This is the **recommended** approach per OpenTelemetry documentation:
- Use standard SDK
- Use OTLP exporters
- Let infrastructure handle backend-specific routing

## What You Need to Do

### 1. Azure Setup (One-time)
Follow the deployment guide to:
- Register preview features
- Enable application monitoring on AKS cluster
- Enable OTLP support in Application Insights
- Deploy the application

See: `DEPLOYMENT-GUIDE.md`

### 2. Build and Deploy
```bash
# Build images with new code
cd simple-3tier/frontend
docker build -t <your-acr>.azurecr.io/otel-3tier-frontend:latest .
docker push <your-acr>.azurecr.io/otel-3tier-frontend:latest

cd ../backend
docker build -t <your-acr>.azurecr.io/otel-3tier-backend:latest .
docker push <your-acr>.azurecr.io/otel-3tier-backend:latest

# Deploy to Kubernetes
cd ../k8s
kubectl apply -f deployment.yaml
```

### 3. Verify
```bash
# Check pods
kubectl get pods -n otel-3tier

# Check injected environment variables
kubectl exec deployment/frontend -n otel-3tier -- env | grep OTEL_EXPORTER

# Generate traffic
export FRONTEND_IP=$(kubectl get svc frontend -n otel-3tier -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl http://$FRONTEND_IP/api/users

# Wait 10 minutes, then check Application Insights in Azure Portal
```

## Compatibility

### What Works
✅ All manual instrumentation (`tracer.startSpan()`, custom attributes)
✅ Automatic instrumentation (HTTP, Express, PostgreSQL)
✅ Distributed tracing across services
✅ Application Map in Azure Monitor
✅ Performance monitoring
✅ Log correlation

### What's Different
- Environment variable names (standard OTel conventions)
- No Azure-specific connection string needed
- OTLP endpoint configured by infrastructure

### What's Not Supported (Preview Limitations)
❌ OTLP/gRPC (only OTLP/HTTP with binary protobuf)
❌ Compression in SDK exporters
❌ Windows node pools
❌ Linux ARM64 node pools

## Troubleshooting

### Application Not Exporting Telemetry

**Check 1: Is the addon installed?**
```bash
kubectl get pods -n kube-system | grep -E 'ama-|otel'
```

**Check 2: Are environment variables injected?**
```bash
kubectl exec deployment/frontend -n otel-3tier -- env | grep OTEL
```

You should see:
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://...`
- `OTEL_SERVICE_NAME=frontend`

**Check 3: Are there errors in application logs?**
```bash
kubectl logs -l app=frontend -n otel-3tier | grep -i error
```

**Check 4: Did you wait long enough?**
Telemetry ingestion can take 5-15 minutes after the first requests.

### Preview Feature Not Registered

```bash
# Check status
az feature show \
  --namespace "Microsoft.ContainerService" \
  --name "AzureMonitorAppMonitoringPreview"

# If not "Registered", wait a few more minutes
# Registration can take 5-10 minutes
```

### OTLP Support Not Enabled

1. Go to Azure Portal
2. Navigate to Application Insights resource
3. Settings → Properties
4. Verify "Enable OTLP Support (Preview)" = **Enabled**
5. If not, enable it and click Save
6. Restart your pods:
```bash
kubectl rollout restart deployment -n otel-3tier
```

## Documentation Updates Needed

After deploying and verifying this works:

1. **Update BLOG-POST.md** to reflect:
   - Standard OTel approach instead of Azure distro
   - Autoconfiguration feature explanation
   - How the AKS addon works

2. **Update other status/telemetry docs** to match the new implementation

3. **Add screenshots** of:
   - Azure Portal showing OTLP support enabled
   - Application Map with services
   - Distributed traces

## Questions?

**Q: Why not use Azure Monitor distro?**
A: The distro is convenient but ties your application to Azure. Standard OTel is more portable and follows best practices.

**Q: What if I want to use a different backend?**
A: Just remove the namespace annotation and set `OTEL_EXPORTER_OTLP_ENDPOINT` to point to Jaeger, Tempo, or any OTLP backend.

**Q: Does this work in production?**
A: The Autoconfiguration feature is in **preview**. For production, consider:
- Using Azure Monitor distro (stable)
- Using standard OTel with manual OTLP endpoint configuration
- Waiting for Autoconfiguration to GA

**Q: Can I mix both approaches?**
A: No - choose one. Either use Azure Monitor distro OR standard OTel with Autoconfiguration. Don't mix them.

## Next Steps

1. Follow `DEPLOYMENT-GUIDE.md` to set up Azure infrastructure
2. Build and deploy the refactored application
3. Verify telemetry flows to Azure Monitor
4. Update blog post and documentation
5. Consider writing about this approach (it's quite new!)

---

**Migration completed:** February 8, 2026
**Approach:** Standard OpenTelemetry + Azure Monitor Autoconfiguration (Preview)
**Files modified:** 6 (frontend/backend code, package.json, deployment.yaml)
