// 共享 TG 推送模块：带重试的 sendMessage / sendDocument。
// 四个服务（sodex-watch / HYPE-watch / sodex-discovery / HYPE-discovery）共用。
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const RETRIES = 2;
const BACKOFF = [3000, 6000];
const TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 带重试的 TG sendMessage。
 * @returns {{ok:boolean, messageId?:number, error?:string}}
 */
export async function sendWithRetry(token, chatId, text) {
  if (!token || !chatId) return { ok: false, error: "missing token/chatId" };

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF[attempt - 1]);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const body = await res.json();
      if (body.ok) return { ok: true, messageId: body.result?.message_id };

      // 4xx 不重试（token/chat/permission 错误重试无意义）
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, error: `${body.description ?? "unknown"} (${res.status})` };
      }
      // 5xx：服务端临时错误，重试
    } catch (e) {
      // 网络错误 / 超时：重试
    }
  }
  return { ok: false, error: "retries exhausted" };
}

/**
 * 带重试的 TG sendDocument（上传 .md 文件）。
 * @returns {{ok:boolean, messageId?:number, error?:string}}
 */
export async function sendDocumentWithRetry(token, chatId, filePath, caption) {
  if (!token || !chatId) return { ok: false, error: "missing token/chatId" };

  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (e) {
    return { ok: false, error: `read file failed: ${e.message}` };
  }

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF[attempt - 1]);

    try {
      const blob = new Blob([buffer], { type: "text/markdown" });
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("document", blob, basename(filePath));
      form.append("caption", caption);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const body = await res.json();
      if (body.ok) return { ok: true, messageId: body.result?.message_id };

      if (res.status >= 400 && res.status < 500) {
        return { ok: false, error: `${body.description ?? "unknown"} (${res.status})` };
      }
    } catch (e) {
      // 网络错误 / 超时：重试
    }
  }
  return { ok: false, error: "retries exhausted" };
}
