// server.js — zero-dependency HTTP server for EXPLAIN Humanizer
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { humanizeExplain } from "./humanizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load environment variables natively if .env file exists (Node 20.6+)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Non-fatal if .env cannot be loaded
  }
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.resolve(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // Global Security Headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';"
  );

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // ── API endpoint ──────────────────────────────────────────────────────────
  if (url.pathname === "/api/humanize") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Method Not Allowed" }));
    }

    let body = "";
    let bodySize = 0;
    let payloadTooLarge = false;
    const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit

    req.on("data", (chunk) => {
      if (payloadTooLarge) return;
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        payloadTooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large. Maximum plan size is 1MB." }));
        req.resume();
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      if (payloadTooLarge) return;

      try {
        let parsedBody;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid JSON payload" }));
        }

        const { plan, dialect } = parsedBody;
        
        if (!plan || typeof plan !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Missing or invalid plan text" }));
        }

        // Validate dialect if provided
        const validDialects = ["postgres", "mysql"];
        const safeDialect = (dialect && validDialects.includes(dialect)) ? dialect : "postgres";

        const result = humanizeExplain(plan.trim(), safeDialect);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("Analysis error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "An internal error occurred during plan analysis." }));
      }
    });
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    return res.end("Method Not Allowed");
  }

  // Sanitize path against directory traversal
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Malformed request URL" }));
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  // Strict path boundary check
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(data);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  EXPLAIN Humanizer running at http://${HOST}:${PORT}\n`);
});
