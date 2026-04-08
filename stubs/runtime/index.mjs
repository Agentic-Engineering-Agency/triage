// Stub runtime server — minimal Hono-like HTTP server for testing docker-compose
// Responds to health checks so the full 9-container stack can start
import { createServer } from 'node:http';

const PORT = parseInt(process.env.PORT || '4111', 10);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (url.pathname === '/health' || url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', stub: true, timestamp: new Date().toISOString() }));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      message: 'Triage runtime stub — real API not yet implemented',
      path: url.pathname 
    }));
    return;
  }

  if (url.pathname.startsWith('/auth/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      message: 'Triage auth stub — Better Auth not yet implemented',
      path: url.pathname 
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[stub] Triage runtime listening on :${PORT}`);
});
