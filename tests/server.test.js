import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function run() {
  const serverPath = path.join(__dirname, '../server.js');
  const serverProc = spawn('node', [serverPath], { env: { ...process.env, PORT: 3001 } });

  await new Promise(r => setTimeout(r, 1000)); // wait for server to start

  try {
    // Test 1: Malformed URL (Issue 3)
    const urlRes = await new Promise((resolve, reject) => {
      const req = http.request('http://127.0.0.1:3001/%c0%80', { method: 'GET' }, res => resolve(res));
      req.on('error', reject);
      req.end();
    });
    
    if (urlRes.statusCode !== 400) {
      throw new Error('Malformed URL should return 400, got ' + urlRes.statusCode);
    }

    // Test 2: Malformed JSON payload to API
    const jsonRes = await new Promise((resolve, reject) => {
      const req = http.request('http://127.0.0.1:3001/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      });
      req.on('error', reject);
      req.write('{bad_json: 1}');
      req.end();
    });

    if (jsonRes.statusCode !== 400) {
      throw new Error('Malformed JSON payload should return 400, got ' + jsonRes.statusCode);
    }

    // Test 3: Plan is malformed JSON
    const planRes = await new Promise((resolve, reject) => {
      const req = http.request('http://127.0.0.1:3001/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(JSON.stringify({ plan: '{ "Plan": { bad ', dialect: 'postgres' }));
      req.end();
    });

    if (planRes.statusCode !== 200) {
      throw new Error('Malformed plan JSON should not crash, got ' + planRes.statusCode);
    }
    if (planRes.data.verdictTitle !== "Could Not Parse Plan") {
      throw new Error('Malformed plan JSON should return fallback analysis');
    }

    // Test 4: GET on API endpoint should be 405
    const methodRes = await new Promise((resolve, reject) => {
      const req = http.request('http://127.0.0.1:3001/api/humanize', { method: 'GET' }, res => resolve(res));
      req.on('error', reject);
      req.end();
    });
    if (methodRes.statusCode !== 405) {
      throw new Error('GET /api/humanize should return 405, got ' + methodRes.statusCode);
    }

    // Test 5: oversized payload returns 413 instead of closing the socket
    const oversizedRes = await new Promise((resolve, reject) => {
      const req = http.request('http://127.0.0.1:3001/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end(Buffer.alloc(1024 * 1024 + 1, 'x'));
    });

    if (oversizedRes.statusCode !== 413) {
      throw new Error('Oversized payload should return 413, got ' + oversizedRes.statusCode);
    }
    if (oversizedRes.data.error !== 'Payload too large. Maximum plan size is 1MB.') {
      throw new Error('Oversized payload should return the size limit error');
    }

    // Test 6: index.html serves fine
    const indexRes = await new Promise((resolve, reject) => {
      const req = http.request('http://127.0.0.1:3001/', { method: 'GET' }, res => resolve(res));
      req.on('error', reject);
      req.end();
    });
    if (indexRes.statusCode !== 200) {
      throw new Error('index.html should return 200, got ' + indexRes.statusCode);
    }
  } finally {
    serverProc.kill();
  }
}
