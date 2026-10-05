import { timingSafeEqual, randomUUID } from "node:crypto";
import { open, rename, unlink, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { LexRuntimeV2Client, RecognizeTextCommand } from "@aws-sdk/client-lex-runtime-v2";

export const cloudRoutes = {
  "/api/sns": ["POST"],
  "/api/ses": ["POST"],
  "/api/efs": ["GET", "POST"],
  "/api/lex": ["POST"],
};

export function createCloudDemo({
  writeToken = process.env.DEMO_WRITE_TOKEN || "",
  topicArn = process.env.SNS_TOPIC_ARN,
  sesFrom = process.env.SES_FROM_EMAIL,
  sesTo = process.env.SES_TO_EMAIL,
  efsDirectory = process.env.EFS_DIRECTORY,
  efsStatfs = statfs,
  lexBotId = process.env.LEX_BOT_ID,
  lexAliasId = process.env.LEX_BOT_ALIAS_ID || "TSTALIASID",
  lexLocaleId = process.env.LEX_LOCALE_ID || "en_US",
  snsClient = new SNSClient({ region: process.env.AWS_REGION || "ap-southeast-1", maxAttempts: 1 }),
  sesClient = new SESClient({ region: process.env.SES_REGION || process.env.AWS_REGION || "ap-southeast-1", maxAttempts: 1 }),
  lexClient = new LexRuntimeV2Client({ region: process.env.AWS_REGION || "ap-southeast-1", maxAttempts: 1 }),
  now = Date.now,
} = {}) {
  const lastSend = new Map();
  let windowStart = now();
  let requests = 0;
  const configured = {
    sns: Boolean(topicArn), ses: Boolean(sesFrom && sesTo),
    efs: Boolean(efsDirectory), lex: Boolean(lexBotId),
  };
  const validText = (text, max) => typeof text === "string" && text.trim().length > 0 && text.length <= max;

  function authorize(req, send) {
    if (writeToken.length < 32) {
      send(503, { error: "Cần cấu hình DEMO_WRITE_TOKEN ít nhất 32 ký tự trên backend." });
      return false;
    }
    const supplied = Buffer.from(req.headers["x-demo-token"] || "");
    const expected = Buffer.from(writeToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      send(403, { error: "Mã demo không đúng. Nhập mã được cấu hình trên EC2." });
      return false;
    }
    // ponytail: one shared limit for this single-instance lab; use a shared store for multiple servers.
    if (now() - windowStart >= 60000) { windowStart = now(); requests = 0; }
    if (++requests > 60) {
      send(429, { error: "Demo giới hạn 60 request/phút. Đợi một phút rồi thử lại." });
      return false;
    }
    return true;
  }

  async function handle(path, method, body, send) {
    const service = path.slice(5);
    if (!configured[service]) return send(503, { error: `Chưa cấu hình ${service.toUpperCase()} trên backend. Xem backend/.env.example.` });
    if ((service === "sns" || service === "ses") && !validText(body.message, 2000))
      return send(400, { error: "Nội dung cần có từ 1 đến 2000 ký tự." });
    if (service === "efs" && method === "POST" && !validText(body.content, 2000))
      return send(400, { error: "Nội dung file cần có từ 1 đến 2000 ký tự." });
    if (service === "lex" && (!validText(body.text, 1024) || typeof body.sessionId !== "string" || !/^[0-9a-zA-Z._:-]{2,100}$/.test(body.sessionId)))
      return send(400, { error: "Text cần có 1–1024 ký tự và sessionId hợp lệ (2–100 ký tự)." });
    if (service === "sns" || service === "ses") {
      const previous = lastSend.get(service);
      if (previous !== undefined && now() - previous < 10000)
        return send(429, { error: "Đợi 10 giây giữa hai lần gửi để tránh gửi trùng." });
      lastSend.set(service, now());
    }
    try {
      const options = { abortSignal: AbortSignal.timeout(5000) };
      if (service === "sns") {
        const result = await snsClient.send(new PublishCommand({
          TopicArn: topicArn, Subject: "Artium cloud demo", Message: body.message.trim(),
        }), options);
        return send(200, { message: "SNS đã nhận thông báo để gửi tới các subscription đã xác nhận.", messageId: result.MessageId });
      }
      if (service === "ses") {
        const result = await sesClient.send(new SendEmailCommand({
          Source: sesFrom, Destination: { ToAddresses: [sesTo] },
          Message: { Subject: { Data: "Artium SES demo", Charset: "UTF-8" },
            Body: { Text: { Data: body.message.trim(), Charset: "UTF-8" } } },
        }), options);
        return send(200, { message: "SES đã nhận email để gửi. Kiểm tra inbox và spam của email demo.", messageId: result.MessageId });
      }
      if (service === "lex") {
        const result = await lexClient.send(new RecognizeTextCommand({
          botId: lexBotId, botAliasId: lexAliasId, localeId: lexLocaleId,
          sessionId: body.sessionId, text: body.text.trim(),
        }), options);
        return send(200, {
          messages: (result.messages || []).filter(message => message.contentType === "PlainText")
            .map(message => ({ content: message.content, contentType: message.contentType })),
          intent: result.sessionState?.intent || null,
          slotToElicit: result.sessionState?.dialogAction?.slotToElicit || null,
          sessionId: result.sessionId,
          confidence: result.interpretations?.[0]?.nluConfidence?.score ?? null,
        });
      }
      // Never silently write to the EC2 root disk when EFS is unmounted.
      if ((await efsStatfs(efsDirectory)).type !== 0x6969)
        return send(503, { error: "EFS chưa mount. Không ghi dữ liệu vào ổ local của EC2." });
      const file = join(efsDirectory, "web-demo.txt");
      if (method === "POST") {
        const temporary = join(efsDirectory, `.web-demo-${randomUUID()}.tmp`);
        try {
          const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try { await handle.writeFile(body.content, "utf8"); } finally { await handle.close(); }
          await rename(temporary, file);
        } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
        return send(200, { message: "Đã ghi web-demo.txt trên EFS.", content: body.content });
      }
      let handle;
      try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) {
        if (error.code === "ENOENT") return send(200, { content: "", exists: false, message: "Chưa có web-demo.txt trên EFS." });
        throw error;
      }
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Not a regular file");
        const buffer = Buffer.alloc(8193);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
          if (!chunk.bytesRead) break;
          bytesRead += chunk.bytesRead;
        }
        if (bytesRead > 8192) throw new Error("File too large");
        return send(200, { content: buffer.toString("utf8", 0, bytesRead), exists: true, message: "Đã đọc web-demo.txt từ EFS." });
      } finally { await handle.close(); }
    } catch (error) {
      console.error(`${service.toUpperCase()} request failed:`, error.name);
      const errors = {
        sns: "Không gửi được SNS. Kiểm tra topic, region, IAM và subscription. Nếu lỗi timeout, kiểm tra inbox trước khi gửi lại.",
        ses: "Không gửi được SES. Kiểm tra region, IAM và email đã verify; sandbox yêu cầu verify cả người nhận. Nếu timeout, kiểm tra inbox trước khi gửi lại.",
        lex: "Không gọi được Lex. Kiểm tra bot, alias đã build và quyền lex:RecognizeText. Bắt đầu hội thoại mới nếu lỗi timeout.",
        efs: "Không đọc/ghi được EFS. Kiểm tra mount, quyền thư mục thinh và file web-demo.txt (không dùng symlink).",
      };
      return send(service === "efs" ? 503 : 502, { error: errors[service] });
    }
  }
  return { authorize, handle, configured };
}
