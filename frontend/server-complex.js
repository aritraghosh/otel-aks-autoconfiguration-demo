// Initialize OpenTelemetry with standard SDK
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

// Enable debug logging
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

console.log('=== OpenTelemetry Configuration ===');
console.log('OTEL_SERVICE_NAME:', process.env.OTEL_SERVICE_NAME);
console.log('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
console.log('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
console.log('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT);
console.log('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL:', process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL);

// Create exporters with explicit configuration (compression disabled per Azure Monitor requirements)
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  compression: 'none',
});

const metricExporter = new OTLPMetricExporter({
  url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || 'http://localhost:4318/v1/metrics',
  compression: 'none',
});

const logExporter = new OTLPLogExporter({
  url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || 'http://localhost:4318/v1/logs',
  compression: 'none',
});

console.log('Trace Exporter URL:', traceExporter.url);
console.log('===================================');

// Configure OpenTelemetry SDK with explicit BatchSpanProcessor
const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'frontend',
  }),
  spanProcessor: new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 100,
    scheduledDelayMillis: 1000, // Export every 1 second for faster visibility
    exportTimeoutMillis: 30000,
    maxExportBatchSize: 10,
  }),
  logRecordProcessor: logExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 10000, // Export every 10 seconds
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Automatic instrumentation for HTTP, axios, etc.
      '@opentelemetry/instrumentation-http': {},
      '@opentelemetry/instrumentation-express': {},
    }),
  ],
});

try {
  sdk.start();
  console.log('✅ OpenTelemetry SDK started successfully');
} catch (error) {
  console.error('❌ Error starting OpenTelemetry SDK:', error);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('OpenTelemetry SDK terminated'))
    .catch((error) => console.log('Error terminating OpenTelemetry SDK', error))
    .finally(() => process.exit(0));
});

const express = require('express');
const axios = require('axios');
const { trace, context } = require('@opentelemetry/api');

const app = express();
const PORT = process.env.PORT || 8080;
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8080';

const tracer = trace.getTracer('frontend-service');

// Middleware for request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'frontend' });
});

// Home page
app.get('/', async (req, res) => {
  const span = tracer.startSpan('frontend.homepage');

  try {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>3-Tier OTel Demo</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .container { max-width: 800px; margin: 0 auto; }
            button {
              padding: 15px 30px;
              font-size: 16px;
              margin: 10px;
              cursor: pointer;
              background-color: #0078D4;
              color: white;
              border: none;
              border-radius: 4px;
            }
            button:hover { background-color: #106EBE; }
            .result {
              margin-top: 20px;
              padding: 20px;
              background-color: #f0f0f0;
              border-radius: 4px;
            }
            h1 { color: #333; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 3-Tier OpenTelemetry Demo</h1>
            <p>This demo shows distributed tracing across Frontend → Backend → Database</p>

            <h2>Test Operations:</h2>
            <button onclick="getUsers()">Get All Users</button>
            <button onclick="getUser()">Get User #1</button>
            <button onclick="createUser()">Create User</button>
            <button onclick="getStats()">Get Stats</button>

            <div id="result" class="result" style="display:none;">
              <h3>Result:</h3>
              <pre id="output"></pre>
            </div>
          </div>

          <script>
            async function callApi(endpoint) {
              const resultDiv = document.getElementById('result');
              const outputPre = document.getElementById('output');

              try {
                const response = await fetch(endpoint);
                const data = await response.json();
                outputPre.textContent = JSON.stringify(data, null, 2);
                resultDiv.style.display = 'block';
              } catch (error) {
                outputPre.textContent = 'Error: ' + error.message;
                resultDiv.style.display = 'block';
              }
            }

            function getUsers() { callApi('/api/users'); }
            function getUser() { callApi('/api/users/1'); }
            function createUser() { callApi('/api/users/create'); }
            function getStats() { callApi('/api/stats'); }
          </script>
        </body>
      </html>
    `);

    span.setAttributes({
      'http.method': 'GET',
      'http.route': '/',
      'http.status_code': 200
    });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// API: Get all users
app.get('/api/users', async (req, res) => {
  const span = tracer.startSpan('frontend.getUsers');

  try {
    console.log(`Calling backend: ${BACKEND_URL}/users`);
    const response = await axios.get(`${BACKEND_URL}/users`);

    span.setAttributes({
      'http.method': 'GET',
      'http.url': `${BACKEND_URL}/users`,
      'http.status_code': response.status,
      'user.count': response.data.length
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error calling backend:', error.message);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// API: Get specific user
app.get('/api/users/:id', async (req, res) => {
  const span = tracer.startSpan('frontend.getUser');
  const userId = req.params.id;

  try {
    console.log(`Calling backend: ${BACKEND_URL}/users/${userId}`);
    const response = await axios.get(`${BACKEND_URL}/users/${userId}`);

    span.setAttributes({
      'http.method': 'GET',
      'http.url': `${BACKEND_URL}/users/${userId}`,
      'http.status_code': response.status,
      'user.id': userId
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error calling backend:', error.message);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// API: Create user
app.get('/api/users/create', async (req, res) => {
  const span = tracer.startSpan('frontend.createUser');

  try {
    console.log(`Calling backend: ${BACKEND_URL}/users/create`);
    const response = await axios.post(`${BACKEND_URL}/users/create`, {
      name: `User${Date.now()}`,
      email: `user${Date.now()}@example.com`
    });

    span.setAttributes({
      'http.method': 'POST',
      'http.url': `${BACKEND_URL}/users/create`,
      'http.status_code': response.status
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error calling backend:', error.message);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// API: Get stats
app.get('/api/stats', async (req, res) => {
  const span = tracer.startSpan('frontend.getStats');

  try {
    console.log(`Calling backend: ${BACKEND_URL}/stats`);
    const response = await axios.get(`${BACKEND_URL}/stats`);

    span.setAttributes({
      'http.method': 'GET',
      'http.url': `${BACKEND_URL}/stats`,
      'http.status_code': response.status
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error calling backend:', error.message);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend service listening on port ${PORT}`);
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`OpenTelemetry SDK configured with standard OTLP exporter`);
});
