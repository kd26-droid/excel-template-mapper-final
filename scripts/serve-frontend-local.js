const fs = require('fs');
const http = require('http');
const path = require('path');

const port = Number(process.env.PORT || 3001);
const apiTarget = process.env.API_TARGET || 'http://127.0.0.1:8001';
const root = path.resolve(__dirname, '..', 'frontend', 'build');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

const proxyApi = (req, res) => {
  const target = new URL(req.url, apiTarget);
  const proxyReq = http.request(
    target,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    send(res, 502, `Backend proxy failed: ${error.message}`, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  });

  req.pipe(proxyReq);
};

const serveStatic = (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = path.normalize(path.join(root, pathname));
  if (!requested.startsWith(root)) {
    send(res, 403, 'Forbidden');
    return;
  }

  const assetPath = fs.existsSync(requested) && fs.statSync(requested).isFile()
    ? requested
    : path.join(root, 'index.html');
  const ext = path.extname(assetPath).toLowerCase();

  fs.readFile(assetPath, (error, content) => {
    if (error) {
      send(res, 404, 'Not found');
      return;
    }
    send(res, 200, content, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=31536000, immutable',
    });
  });
};

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  serveStatic(req, res);
}).listen(port, () => {
  console.log(`Frontend listening on http://localhost:${port}`);
  console.log(`Proxying /api to ${apiTarget}`);
});
