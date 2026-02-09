# OpenTelemetry Auto-Configuration for Azure Kubernetes Service - Demo

This repository demonstrates how to use **standard OpenTelemetry SDK** with **Azure Monitor Auto-Configuration** for AKS to automatically send telemetry to Application Insights—with zero Azure-specific code in your applications.

## 🎯 What This Demo Shows

- ✅ **Standard OpenTelemetry**: Pure OpenTelemetry instrumentation (no Azure dependencies)
- ✅ **Auto-Configuration**: Automatic routing to Application Insights via AMA
- ✅ **Distributed Tracing**: End-to-end traces across frontend → backend → database
- ✅ **Zero Lock-in**: Code works with any OpenTelemetry backend
- ✅ **Production-Ready**: Latest SDK versions with best practices

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Applications (Node.js + OpenTelemetry SDK v0.211.0)            │
│  • Frontend (Express.js)                                         │
│  • Backend (Express.js + PostgreSQL)                            │
└───────────────────┬──────────────────────────────────────────────┘
                    │
                    │ OTLP/HTTP (Binary Protobuf)
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Azure Monitor Agent (AMA) - DaemonSet                          │
│  • Port 28331: Traces/Logs                                      │
│  • Port 28333: Metrics                                          │
│  • Namespace-aware routing via DCR                              │
└───────────────────┬──────────────────────────────────────────────┘
                    │
                    │ Via Data Collection Rule (DCR)
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Application Insights                                            │
│  • Distributed tracing                                           │
│  • Application map                                               │
│  • Performance monitoring                                        │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Azure subscription
- Azure CLI installed and logged in
- kubectl installed
- Docker installed
- jq installed

### 1. Clone Repository

```bash
git clone https://github.com/your-repo/otel-aks-demo
cd otel-aks-demo/simple-3tier
```

### 2. Configure

```bash
cp config.env.example config.env
# Edit config.env with your Azure subscription ID and preferences
vi config.env
```

### 3. Run Setup

```bash
# Create Azure resources (AKS, ACR, Application Insights)
./scripts/setup.sh

# Build and push Docker images
./scripts/build-and-push.sh

# Deploy applications
./scripts/deploy.sh
```

### 4. Test

```bash
# Get frontend URL
kubectl get svc frontend -n otel-demo

# Generate traffic
curl http://<FRONTEND-IP>/api/users
curl http://<FRONTEND-IP>/api/stats
```

### 5. View Telemetry

Wait 3-5 minutes for data ingestion, then check Application Insights in Azure Portal.

## 📚 Documentation

- **[SETUP.md](./SETUP.md)** - Detailed setup guide with step-by-step instructions
- **[BLOG-POST.md](./BLOG-POST.md)** - Complete blog post explaining the approach
- **[DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md)** - Original deployment documentation
- **[MIGRATION-SUMMARY.md](./MIGRATION-SUMMARY.md)** - Migration from Azure Monitor distro

## 🔑 Key Features

### 100% Standard OpenTelemetry

```javascript
// frontend/server.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();  // That's it!
```

**No Azure-specific dependencies:**
```json
{
  "dependencies": {
    "@opentelemetry/sdk-node": "^0.211.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/auto-instrumentations-node": "^0.52.0"
  }
}
```

### Auto-Configuration Setup

```bash
# 1. Annotate namespace
kubectl annotate namespace otel-demo \
  instrumentation.opentelemetry.io/inject-configuration="true"

# 2. Create Instrumentation CR
kubectl apply -f - <<EOF
apiVersion: monitor.azure.com/v1
kind: Instrumentation
metadata:
  name: default
  namespace: otel-demo
spec:
  destination:
    applicationInsightsConnectionString: "..."
EOF
```

That's all the Azure-specific configuration needed!

## 📊 What You Get

### Distributed Tracing
- Complete request traces from frontend → backend → database
- Timing breakdown for each operation
- Correlation across services

### Application Map
```
[otel-demo]/frontend ──▶ [otel-demo]/backend ──▶ PostgreSQL
     HTTP                    HTTP                   SQL
```

### Performance Monitoring
- Request rates and latencies
- Dependency call durations
- Database query performance
- Custom metrics

### Query Examples

```kusto
// Recent requests by service
requests
| where timestamp > ago(10m)
| summarize count() by cloud_RoleName, name

// Slow requests
requests
| where duration > 1000
| project timestamp, name, duration, cloud_RoleName
| order by duration desc
```

## 🛠️ Key Requirements

### ✅ Latest SDK Versions Required

Using old SDK versions (like 0.45.0) will result in 400 errors. Must use:
- `@opentelemetry/sdk-node`: `^0.211.0`
- `@opentelemetry/api`: `^1.9.0`
- `@opentelemetry/auto-instrumentations-node`: `^0.52.0`

### ✅ Protocol Requirements

- **OTLP/HTTP with binary Protobuf only**
- ❌ OTLP/gRPC not supported
- ❌ JSON payloads not supported
- ❌ Compression not supported

### ✅ Configuration Best Practices

- Let SDK auto-configure from environment variables
- Don't override with explicit exporters
- Restart AMA pods after creating Instrumentation CR

## 🔍 Troubleshooting

### No Data in Application Insights?

**Check 1: Verify environment variables**
```bash
kubectl exec -n otel-demo deployment/frontend -- env | grep OTEL_EXPORTER
```

**Check 2: Restart AMA pods**
```bash
kubectl delete pods -n kube-system -l rsName=ama-logs
```

**Check 3: Verify SDK version**
```bash
kubectl exec -n otel-demo deployment/frontend -- npm list @opentelemetry/sdk-node
```

**Check 4: Check logs for errors**
```bash
kubectl logs -n otel-demo deployment/frontend | grep -i error
```

See [SETUP.md](./SETUP.md) for more troubleshooting steps.

## 💰 Cost Estimate

Typical costs for running this demo:
- **AKS** (2 x Standard_DS2_v2): ~$140/month
- **ACR** (Basic): ~$5/month
- **Application Insights**: Pay-per-GB (first 5GB free)
  - Small app: ~2-3 GB/month = Free
  - Medium app: ~10 GB/month = ~$2.30/month

**💡 Cost-saving tip**: Delete resources when not in use:
```bash
./scripts/cleanup.sh
```

## 🎓 Learning Path

1. **Start here**: Follow [SETUP.md](./SETUP.md) for detailed walkthrough
2. **Understand the approach**: Read [BLOG-POST.md](./BLOG-POST.md)
3. **Explore the code**: Check `frontend/server.js` and `backend/server.js`
4. **Query telemetry**: Use Azure Portal or CLI to query Application Insights
5. **Customize**: Add custom spans, metrics, and attributes

## 📁 Repository Structure

```
simple-3tier/
├── README.md                  # This file
├── SETUP.md                   # Detailed setup guide
├── BLOG-POST.md              # Blog post about the approach
├── config.env.example         # Configuration template
├── scripts/
│   ├── setup.sh              # Create Azure resources
│   ├── build-and-push.sh     # Build and push Docker images
│   ├── deploy.sh             # Deploy to AKS
│   └── cleanup.sh            # Delete all resources
├── frontend/
│   ├── Dockerfile
│   ├── package.json          # Latest OpenTelemetry dependencies
│   └── server.js             # Pure OpenTelemetry instrumentation
├── backend/
│   ├── Dockerfile
│   ├── package.json          # Latest OpenTelemetry dependencies
│   └── server.js             # Pure OpenTelemetry instrumentation
└── k8s/
    └── deployment.yaml        # Kubernetes manifests
```

## 🤝 Contributing

Found an issue or have a suggestion? Please open an issue or PR!

## 📝 License

[Your License]

## 🔗 Related Resources

- **Azure Monitor Documentation**: [OpenTelemetry for AKS](https://learn.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-open-protocol)
- **OpenTelemetry**: [opentelemetry.io](https://opentelemetry.io)
- **Node.js SDK**: [OpenTelemetry Node.js](https://opentelemetry.io/docs/languages/js/)

## 📧 Contact

Questions? Feedback? Open an issue or reach out:
- GitHub Issues: [github.com/your-repo/otel-aks-demo/issues](https://github.com/your-repo/otel-aks-demo/issues)
- Twitter: [@your-handle]
- Blog: [your-blog.com]

---

⭐ If you find this demo helpful, please star the repository!
