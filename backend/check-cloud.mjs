import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoServer } from "./server.mjs";

// Real HTTP and filesystem. Only AWS network calls and the NFS mount probe are replaced.
// Catches public sends, caller-selected recipients, local-disk fallback and lost Lex sessions.
const directory = await mkdtemp(join(tmpdir(), "cloud-demo-"));
const token = "test-demo-token-32-characters-long";
const topic = "arn:aws:sns:ap-southeast-1:461508717285:demo";
let mounted = true;
let now = 100000;
let denied = false;
const calls = [];
const client = {
  async send(command) {
    calls.push(command);
    if (denied) throw Object.assign(new Error("Private AWS detail"), { name: "AccessDeniedException" });
    if (command.constructor.name === "RecognizeTextCommand") return {
      sessionId: command.input.sessionId,
      messages: [{ contentType: "PlainText", content: "Which painting?" }],
      sessionState: { dialogAction: { type: "ElicitSlot", slotToElicit: "PaintingName" },
        intent: { name: "OrderPainting", state: "InProgress", confirmationState: "None",
          slots: { PaintingName: null, Quantity: null } } },
      interpretations: [{ nluConfidence: { score: 0.9 }, intent: { name: "OrderPainting" } }]
    };
    return { MessageId: "accepted-message-id", $metadata: { httpStatusCode: 200 } };
  }
};
const server = createDemoServer({ bucket: "", writeToken: token, topicArn: topic,
  sesFrom: "sender@example.com", sesTo: "recipient@example.com",
  efsDirectory: directory, efsStatfs: async () => ({ type: mounted ? 0x6969 : 0xef53 }),
  lexBotId: "JHDVF8HBVM", lexAliasId: "TSTALIASID", lexLocaleId: "en_US",
  snsClient: client, sesClient: client, lexClient: client, now: () => now });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const request = (path, body, auth = token) => fetch(base + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { "Content-Type": "application/json", "X-Demo-Token": auth },
  body: body === undefined ? undefined : JSON.stringify(body)
});

try {
  assert.equal((await request("/api/sns", { message: "hello" }, "")).status, 403,
    "Public callers must not publish notifications");
  assert.equal(calls.length, 0);
  for (const path of ["/api/sns", "/api/ses"]) {
    assert.equal((await request(path, { message: " " })).status, 400);
    assert.equal((await request(path, { message: "x".repeat(2001) })).status, 400);
  }
  const sent = await request("/api/sns", { message: "Xin chào", topicArn: "attacker-topic" });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).messageId, "accepted-message-id");
  assert.equal(calls.at(-1).input.TopicArn, topic);
  assert.equal(calls.at(-1).input.Message, "Xin chào");
  const beforeRepeat = calls.length;
  assert.equal((await request("/api/sns", { message: "again" })).status, 429);
  assert.equal(calls.length, beforeRepeat, "Repeated sends must not reach AWS");

  const email = await request("/api/ses", { message: "Email demo", to: "attacker@example.com" });
  assert.equal(email.status, 200);
  assert.deepEqual(calls.at(-1).input.Destination.ToAddresses, ["recipient@example.com"]);
  assert.equal(calls.at(-1).input.Source, "sender@example.com");
  assert.equal(calls.at(-1).input.Message.Body.Text.Data, "Email demo");
  assert.equal((await request("/api/ses", { message: "again" })).status, 429);

  mounted = false;
  assert.equal((await request("/api/efs", { content: "must not land on root disk" })).status, 503);
  await assert.rejects(readFile(join(directory, "web-demo.txt")), { code: "ENOENT" });
  mounted = true;
  assert.equal((await request("/api/efs", { content: "Nội dung EFS" })).status, 200);
  assert.equal(await readFile(join(directory, "web-demo.txt"), "utf8"), "Nội dung EFS");
  const read = await request("/api/efs");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "Nội dung EFS");
  assert.equal((await request("/api/efs", { content: "x".repeat(2001) })).status, 400);
  await rm(join(directory, "web-demo.txt"));
  await writeFile(join(directory, "outside.txt"), "private");
  await symlink(join(directory, "outside.txt"), join(directory, "web-demo.txt"));
  assert.equal((await request("/api/efs")).status, 503, "Reads must not follow symlinks");
  assert.equal((await request("/api/efs", { content: "safe replacement" })).status, 200);
  assert.equal(await readFile(join(directory, "outside.txt"), "utf8"), "private");
  await writeFile(join(directory, "web-demo.txt"), "x".repeat(20000));
  assert.equal((await request("/api/efs")).status, 503, "Reads must be bounded even for externally edited files");

  const sessionId = "demo-session-123";
  for (const text of ["I want to order a painting", "sunset"]) {
    const chat = await request("/api/lex", { text, sessionId, botId: "attacker-bot" });
    assert.equal(chat.status, 200);
    const data = await chat.json();
    assert.equal(data.messages[0].content, "Which painting?");
    assert.equal(data.intent.name, "OrderPainting");
    assert.equal(data.slotToElicit, "PaintingName");
    assert.equal(calls.at(-1).input.sessionId, sessionId);
    assert.equal(calls.at(-1).input.botId, "JHDVF8HBVM");
  }
  for (const body of [{ text: "", sessionId }, { text: "x".repeat(1025), sessionId },
    { text: "hello", sessionId: "../escape" }, { text: "hello" }]) {
    assert.equal((await request("/api/lex", body)).status, 400);
  }
  const beforeBlocked = calls.length;
  assert.equal((await fetch(base + "/api/lex", { method: "POST",
    headers: { Origin: "https://untrusted.example", "X-Demo-Token": token,
      "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello", sessionId }) })).status, 403);
  assert.equal(calls.length, beforeBlocked);
  const preflight = await fetch(base + "/api/lex", { method: "OPTIONS",
    headers: { Origin: "https://demo.artium.id.vn" } });
  assert.match(preflight.headers.get("access-control-allow-headers"), /X-Demo-Token/i);
  assert.equal((await request("/api/lex")).status, 405);
  const invalidJson = await fetch(base + "/api/lex", { method: "POST",
    headers: { "Content-Type": "application/json", "X-Demo-Token": token }, body: "{" });
  assert.equal(invalidJson.status, 400);
  const oversized = await request("/api/efs", { content: "ệ".repeat(6000) });
  assert.equal(oversized.status, 413);
  const wrongType = await fetch(base + "/api/sns", { method: "POST",
    headers: { "Content-Type": "text/plain", "X-Demo-Token": token }, body: "hello" });
  assert.equal(wrongType.status, 415);
  denied = true;
  now += 11000;
  for (const path of ["/api/sns", "/api/ses", "/api/lex"]) {
    const response = await request(path, path === "/api/lex" ? { text: "hello", sessionId } : { message: "hello" });
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /Private AWS detail|AccessDeniedException/);
  }
  // Missing configuration must disable only the new integrations, not health/greeting.
  for (const writeToken of ["", token]) {
    const unconfigured = createDemoServer({ bucket: "", writeToken, topicArn: "",
      sesFrom: "", sesTo: "", efsDirectory: "", lexBotId: "" });
    unconfigured.listen(0, "127.0.0.1");
    await once(unconfigured, "listening");
    const url = `http://127.0.0.1:${unconfigured.address().port}`;
    try {
      assert.equal((await fetch(url + "/api/health")).status, 200);
      const response = await fetch(url + "/api/sns", { method: "POST",
        headers: { "Content-Type": "application/json", "X-Demo-Token": token },
        body: JSON.stringify({ message: "hello" }) });
      assert.equal(response.status, 503);
      if (writeToken) {
        for (let count = 1; count < 60; count++) {
          const response = await fetch(url + "/api/efs", { headers: { "X-Demo-Token": token } });
          assert.equal(response.status, 503);
        }
        assert.equal((await fetch(url + "/api/efs", { headers: { "X-Demo-Token": token } })).status, 429);
      }
    } finally {
      unconfigured.closeAllConnections();
      await new Promise(resolve => unconfigured.close(resolve));
    }
  }
  console.log("PASS: cloud auth, fixed destinations, cooldown, EFS mount/read/write/symlinks, Lex sessions and AWS errors");
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
