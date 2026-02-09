// Minimal OpenTelemetry configuration for Azure Monitor Autoconfiguration
// Let the SDK auto-configure from injected environment variables
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

// Enable debug logging
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

console.log('=== OpenTelemetry Environment Variables ===');
console.log('OTEL_SERVICE_NAME:', process.env.OTEL_SERVICE_NAME);
console.log('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
console.log('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
console.log('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT);
console.log('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL:', process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL);
console.log('OTEL_RESOURCE_ATTRIBUTES:', process.env.OTEL_RESOURCE_ATTRIBUTES);
console.log('==========================================');

// Configure OpenTelemetry SDK with minimal configuration
// Let it auto-configure exporters from environment variables
const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {},
      '@opentelemetry/instrumentation-express': {},
      '@opentelemetry/instrumentation-pg': {},
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
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await sdk.shutdown();
  await pool.end();
  process.exit(0);
});

const express = require('express');
const { Pool } = require('pg');
const { trace } = require('@opentelemetry/api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'demodb',
  user: process.env.DB_USER || 'demouser',
  password: process.env.DB_PASSWORD || 'demopass',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const tracer = trace.getTracer('backend-service');

// Initialize database
async function initDatabase() {
  const span = tracer.startSpan('backend.initDatabase');

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert sample data if table is empty
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(countResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO users (name, email) VALUES
        ('Alice Johnson', 'alice@example.com'),
        ('Bob Smith', 'bob@example.com'),
        ('Charlie Brown', 'charlie@example.com')
      `);
      console.log('Sample data inserted');
    }

    span.setAttributes({
      'db.system': 'postgresql',
      'db.operation': 'init'
    });

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
  } finally {
    span.end();
  }
}

// Middleware for logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  const span = tracer.startSpan('backend.health');

  try {
    // Test database connection
    await pool.query('SELECT 1');
    span.setAttribute('db.available', true);
    res.json({
      status: 'healthy',
      service: 'backend',
      database: 'connected'
    });
  } catch (error) {
    span.setAttribute('db.available', false);
    span.recordException(error);
    res.status(503).json({
      status: 'unhealthy',
      service: 'backend',
      database: 'disconnected',
      error: error.message
    });
  } finally {
    span.end();
  }
});

// Get all users
app.get('/users', async (req, res) => {
  const span = tracer.startSpan('backend.getUsers');

  try {
    const result = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY id');

    span.setAttributes({
      'db.system': 'postgresql',
      'db.operation': 'SELECT',
      'db.table': 'users',
      'result.count': result.rows.length
    });

    console.log(`Retrieved ${result.rows.length} users from database`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// Get specific user
app.get('/users/:id', async (req, res) => {
  const span = tracer.startSpan('backend.getUser');
  const userId = req.params.id;

  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [userId]
    );

    span.setAttributes({
      'db.system': 'postgresql',
      'db.operation': 'SELECT',
      'db.table': 'users',
      'user.id': userId,
      'result.found': result.rows.length > 0
    });

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
    } else {
      console.log(`Retrieved user ${userId}`);
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error fetching user:', error);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// Create user
app.post('/users/create', async (req, res) => {
  const span = tracer.startSpan('backend.createUser');
  const { name, email } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email, created_at',
      [name, email]
    );

    span.setAttributes({
      'db.system': 'postgresql',
      'db.operation': 'INSERT',
      'db.table': 'users',
      'user.name': name,
      'user.email': email
    });

    console.log(`Created user: ${name} (${email})`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// Get statistics
app.get('/stats', async (req, res) => {
  const span = tracer.startSpan('backend.getStats');

  try {
    const countResult = await pool.query('SELECT COUNT(*) as total FROM users');
    const recentResult = await pool.query(
      'SELECT COUNT(*) as recent FROM users WHERE created_at > NOW() - INTERVAL \'24 hours\''
    );

    const stats = {
      total_users: parseInt(countResult.rows[0].total),
      recent_users: parseInt(recentResult.rows[0].recent),
      database: 'postgresql',
      timestamp: new Date().toISOString()
    };

    span.setAttributes({
      'db.system': 'postgresql',
      'db.operation': 'SELECT',
      'stats.total_users': stats.total_users,
      'stats.recent_users': stats.recent_users
    });

    console.log(`Stats: ${stats.total_users} total users, ${stats.recent_users} recent`);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Backend service listening on port ${PORT}`);
  console.log(`Database host: ${process.env.DB_HOST || 'postgres'}`);
  console.log(`OpenTelemetry SDK configured with standard OTLP exporter`);

  // Initialize database
  await initDatabase();
});
