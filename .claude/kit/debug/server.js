#!/usr/bin/env node

// 零依赖本地日志收集服务,用于 /k/debug 调试工作流
// 兼容 ESM(项目 package.json 可能有 "type": "module")
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.argv[2] || process.cwd();
const BASE_PORT = parseInt(process.env.DEBUG_PORT || '9876', 10);
const MAX_PORT = BASE_PORT + 4;
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_FILE = path.join(PROJECT_ROOT, 'debug.log');

let entryCount = 0;

// CORS 头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function rotateIfNeeded() {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= MAX_LOG_SIZE) {
      const bakFile = LOG_FILE + '.bak';
      fs.renameSync(LOG_FILE, bakFile);
    }
  } catch {
    // 文件不存在,无需轮转
  }
}

function handleLog(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const entry = {
        tag: data.tag || '',
        data: data.data || null,
        timestamp: data.timestamp || Date.now(),
        sessionStart: data.sessionStart || null,
        url: data.url || '',
        receivedAt: new Date().toISOString(),
      };
      rotateIfNeeded();
      fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
      entryCount++;
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function handleHealth(res, actualPort) {
  res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', entries: entryCount, port: actualPort }));
}

function handleOptions(res) {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method === 'GET' && req.url === '/health') return handleHealth(res, server.actualPort);
  if (req.method === 'POST' && req.url === '/log') return handleLog(req, res);

  res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// 初始化已有日志条数
try {
  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  entryCount = content.split('\n').filter(Boolean).length;
} catch {
  entryCount = 0;
}

// 端口自动递增
function tryListen(port) {
  if (port > MAX_PORT) {
    console.error(`ERROR: 端口 ${BASE_PORT}-${MAX_PORT} 均被占用`);
    process.exit(1);
  }
  server.listen(port, () => {
    server.actualPort = port;
    console.log(`DEBUG_SERVER_PORT=${port}`);
    console.log(`日志写入: ${LOG_FILE}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      tryListen(port + 1);
    } else {
      console.error(err.message);
      process.exit(1);
    }
  });
}

tryListen(BASE_PORT);

// 优雅关闭
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
