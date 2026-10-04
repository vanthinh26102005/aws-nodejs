import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// These objects are intentionally shareable through the public demo API.
// CORS is not authentication; keep private files outside demo/.
function isDemoFile(key) {
  return (
    typeof key === "string" &&
    key.startsWith("demo/") &&
    !key.endsWith("/") &&
    Buffer.byteLength(key, "utf8") <= 1024 &&
    !/[\x00-\x1f\x7f]/.test(key) &&
    !key.split("/").some((part) => part === "." || part === "..")
  );
}

const port = Number(process.env.PORT || 3000);
const origins = new Set(
  (
    process.env.ALLOWED_ORIGINS ||
    `http://localhost:${port},http://127.0.0.1:${port},https://demo.artium.id.vn`
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const assets = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/config.js": ["config.js", "text/javascript"],
  "/app.js": ["app.js", "text/javascript"],
};

export function createDemoServer({
  bucket = process.env.S3_BUCKET,
  s3Client = new S3Client({
    region: process.env.AWS_REGION || "ap-southeast-1",
  }),
} = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
    };
    const pathname = req.url.split("?")[0];
    const origin = req.headers.origin;
    if (origin && !origins.has(origin))
      return send(403, { error: "Origin chưa được cho phép." });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res
        .writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        })
        .end();
      return;
    }
    const method =
      pathname === "/api/greet"
        ? "POST"
        : pathname === "/api/health" ||
            pathname === "/api/files" ||
            pathname === "/api/files/download" ||
            assets[pathname]
          ? "GET"
          : null;
    if (!method) return send(404, { error: "Không tìm thấy endpoint." });
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return send(405, { error: `Endpoint này chỉ nhận ${method}.` });
    }

    try {
      if (assets[pathname]) {
        const [file, contentType] = assets[pathname];
        const content = await readFile(
          new URL(`../frontend/${file}`, import.meta.url),
        );
        res
          .writeHead(200, { "Content-Type": `${contentType}; charset=utf-8` })
          .end(content);
        return;
      }
      if (pathname === "/api/health") {
        return send(200, {
          status: "ok",
          service: "artium-cloud-demo",
          nodeVersion: process.version,
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        });
      }
      if (pathname === "/api/files" || pathname === "/api/files/download") {
        if (!bucket)
          return send(503, { error: "Chưa cấu hình S3_BUCKET trên backend." });
        const key = new URL(req.url, "http://localhost").searchParams.get(
          "key",
        );
        if (pathname === "/api/files/download" && !isDemoFile(key))
          return send(400, { error: "Chỉ cho phép file trong thư mục demo/." });
        try {
          if (pathname === "/api/files") {
            const result = await s3Client.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: "demo/",
                MaxKeys: 10,
              }),
              { abortSignal: AbortSignal.timeout(5000) },
            );
            const files = (result.Contents || []).filter((file) =>
              isDemoFile(file.Key),
            );
            return send(200, {
              files: files.slice(0, 10).map((file) => ({
                key: file.Key,
                size: file.Size,
                lastModified: file.LastModified?.toISOString() || null,
              })),
              truncated: Boolean(result.IsTruncated) || files.length > 10,
            });
          }
          await s3Client.send(
            new HeadObjectCommand({ Bucket: bucket, Key: key }),
            { abortSignal: AbortSignal.timeout(5000) },
          );
          const url = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 300 },
          );
          return send(200, { url, expiresIn: 300 });
        } catch (error) {
          if (
            pathname === "/api/files/download" &&
            error.$metadata?.httpStatusCode === 404 &&
            error.name !== "NoSuchBucket"
          )
            return send(404, { error: "File không còn tồn tại trên S3." });
          console.error("S3 request failed:", error.name);
          return send(502, {
            error:
              "Không đọc được S3. Kiểm tra bucket, region và IAM role của EC2.",
          });
        }
      }
      if (
        req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
        "application/json"
      ) {
        return send(415, { error: "Hãy gửi Content-Type: application/json." });
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > 16 * 1024) {
          req.resume();
          return send(413, { error: "Request tối đa 16 KiB." });
        }
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(400, { error: "JSON không hợp lệ." });
      }
      if (
        !body ||
        Array.isArray(body) ||
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.trim().length > 80
      ) {
        return send(400, { error: "Tên cần có từ 1 đến 80 ký tự." });
      }
      send(200, {
        message: `Xin chào ${body.name.trim()}! Phản hồi này đến từ backend Node.js.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (!res.destroyed && !res.writableEnded)
        send(500, { error: "Server gặp lỗi. Hãy thử lại." });
      console.error("Request failed:", error.message);
    }
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export const server = createDemoServer();

if (import.meta.main) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT phải nằm trong 1–65535.");
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(`Cloud demo: http://${host}:${port}`),
  );
}
