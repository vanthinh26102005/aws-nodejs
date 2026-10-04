import assert from "node:assert/strict";
import { once } from "node:events";
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { createDemoServer } from "./server.mjs";

// Only the external AWS call is replaced. HTTP routing, validation and SDK signing are real.
const bucket = "artium-cloud-demo-thinh-20261005";
const client = new S3Client({
  region: "ap-southeast-1",
  credentials: {
    accessKeyId: "TESTONLY",
    secretAccessKey: "test-only-not-an-aws-secret",
  },
});
let mode = "files";
let calls = 0;
client.send = async (command) => {
  calls++;
  assert.equal(
    command.input.Bucket,
    bucket,
    "Client cannot select a different bucket",
  );
  if (mode === "denied")
    throw Object.assign(new Error("Private AWS diagnostic"), {
      name: "AccessDenied",
    });
  if (mode === "badbucket")
    throw Object.assign(new Error("Missing bucket"), {
      name: "NoSuchBucket",
      $metadata: { httpStatusCode: 404 },
    });
  if (command instanceof ListObjectsV2Command) {
    assert.equal(
      command.input.Prefix,
      "demo/",
      "List must never include private prefixes",
    );
    assert.equal(
      command.input.MaxKeys,
      10,
      "List must bound S3 work per request",
    );
    if (mode === "empty")
      return { $metadata: {}, Contents: [], IsTruncated: false };
    return {
      $metadata: {},
      IsTruncated: true,
      Contents: [
        { Key: "demo/", Size: 0 },
        { Key: "private/secret.txt", Size: 100 },
        { Key: "demo/../secret.txt", Size: 100 },
        ...Array.from({ length: 12 }, (_, i) => ({
          Key: `demo/file-${i}.txt`,
          Size: i,
          LastModified: new Date("2026-10-05T00:00:00Z"),
        })),
      ],
    };
  }
  assert.ok(command instanceof HeadObjectCommand);
  assert.ok(command.input.Key.startsWith("demo/"));
  if (mode === "missing")
    throw Object.assign(new Error("Missing"), {
      $metadata: { httpStatusCode: 404 },
    });
  return { $metadata: {}, ContentLength: 5 };
};
const server = createDemoServer({ bucket, s3Client: client });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const download = (key) =>
  fetch(`${base}/api/files/download?${new URLSearchParams({ key })}`);

try {
  // Catches wrong prefix, leaking folder markers and unbounded result sizes.
  const list = await fetch(`${base}/api/files`, {
    headers: { Origin: "https://demo.artium.id.vn" },
  });
  assert.equal(list.status, 200);
  assert.equal(
    list.headers.get("access-control-allow-origin"),
    "https://demo.artium.id.vn",
  );
  const data = await list.json();
  assert.equal(data.files.length, 10);
  assert.deepEqual(data.files[0], {
    key: "demo/file-0.txt",
    size: 0,
    lastModified: "2026-10-05T00:00:00.000Z",
  });
  assert.equal(data.files.at(-1).key, "demo/file-9.txt");
  assert.equal(data.truncated, true);
  mode = "empty";
  assert.deepEqual((await (await fetch(`${base}/api/files`)).json()).files, []);
  mode = "files";

  // Unicode, spaces and query characters must identify the original object, not another key.
  const key = "demo/ảnh chào & tên%.png";
  const signed = await download(key);
  assert.equal(signed.status, 200);
  const link = await signed.json();
  const url = new URL(link.url);
  assert.equal(url.protocol, "https:");
  assert.equal(
    url.hostname,
    "artium-cloud-demo-thinh-20261005.s3.ap-southeast-1.amazonaws.com",
  );
  assert.equal(decodeURIComponent(url.pathname), "/demo/ảnh chào & tên%.png");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  assert.equal(link.expiresIn, 300);

  // Public endpoint must reject out-of-scope keys before contacting AWS.
  const beforeInvalid = calls;
  for (const key of [
    "",
    "private/secret.txt",
    "demo",
    "demo/",
    "demo/../secret",
    "demo/./x",
    "demo/x\n",
    "demo/" + "ệ".repeat(400),
    "demo%2Fsecret.txt",
  ]) {
    assert.equal(
      (await download(key)).status,
      400,
      `Reject invalid key: ${JSON.stringify(key)}`,
    );
  }
  assert.equal((await fetch(`${base}/api/files/download`)).status, 400);
  assert.equal(calls, beforeInvalid, "Invalid keys must never reach S3");
  assert.equal(
    (
      await fetch(`${base}/api/files`, {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    calls,
    beforeInvalid,
    "Blocked origins must not trigger AWS calls",
  );
  assert.equal(
    (await fetch(`${base}/api/files`, { method: "POST" })).status,
    405,
  );

  mode = "missing";
  assert.equal((await download("demo/missing.png")).status, 404);
  mode = "badbucket";
  assert.equal(
    (await fetch(`${base}/api/files`)).status,
    502,
    "Missing bucket is a configuration failure, not a missing file",
  );
  mode = "denied";
  for (const response of [
    await fetch(`${base}/api/files`),
    await download("demo/file.txt"),
  ]) {
    assert.equal(response.status, 502);
    assert.doesNotMatch(
      await response.text(),
      /Private AWS diagnostic|AccessDenied|TESTONLY/,
    );
  }
  console.log(
    "PASS: S3 prefix, bounded listing, empty bucket, signing, invalid keys, CORS and AWS failures",
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  client.destroy();
}
