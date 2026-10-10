#!/usr/bin/env node
// Zero-cost mock upstream for the xy2api lab and contract tests.
//
// xy2api is configured with an "apikey" account whose base_url points here, so
// every gateway call made by GGUU AI IMAGE travels the real xy2api code path
// (auth, group routing, billing, request ids) but never reaches a paid model.
//
// Speaks just enough of three wire formats:
//   - OpenAI  /v1/models, /v1/chat/completions, /v1/responses,
//             /v1/images/generations, /v1/images/edits
//   - Gemini  /v1beta/models, /v1beta/models/{model}:generateContent
//   - Lab     /healthz, /__mock/requests (recent request summaries, no secrets)
//
// Fault injection is driven by directives inside the prompt / last user message,
// so contract tests can exercise xy2api error mapping without extra endpoints:
//   [[mock:status=429]]  respond with that HTTP status and an OpenAI/Gemini error
//   [[mock:safety]]      content-policy rejection (OpenAI 400 / Gemini blockReason)
//   [[mock:empty]]       200 with no image / no content (malformed success)
//   [[mock:delay=1500]]  sleep before answering (timeouts, aborts)
//   [[mock:imagedelay=20000]]  in a chat message: the generate_image call the
//                        scripted model makes sleeps that long; the chat reply
//                        itself is not delayed (stopping a run mid-generation)
//   [[mock:badtool]]     in a chat message: the scripted model first calls
//                        generate_image with an argument the tool's schema
//                        rejects (placementX: "left"), reads the error the
//                        server hands back, then calls it again correctly
//                        (a tool argument error must not end the run)
//
// TODO(agent01): if xy2api starts forwarding new upstream paths for images
// (e.g. async/batch variants), add them here and record a fixture in
// apps/server/src/features/xy2api/__fixtures__ for the new xy2api version.

import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "0.0.0.0";
// When set, upstream calls must carry this key (proves xy2api forwards the
// account credential instead of the caller's key).
const UPSTREAM_KEY = process.env.MOCK_UPSTREAM_KEY?.trim() || "";
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const RECENT_LIMIT = 200;

const CHAT_MODELS = (process.env.MOCK_CHAT_MODELS ?? "gpt-5.4,gpt-5.4-mini")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const IMAGE_MODELS = (
  process.env.MOCK_IMAGE_MODELS ?? "gpt-image-2,gpt-image-1.5"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GEMINI_MODELS = (
  process.env.MOCK_GEMINI_MODELS ??
  "gemini-3-pro-image,gemini-3.1-flash-image,gemini-2.5-flash-image"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const recent = [];

function log(event, fields) {
  console.log(
    `[mock-upstream] ${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}`,
  );
}

function remember(entry) {
  recent.push(entry);
  if (recent.length > RECENT_LIMIT) recent.shift();
}

// ---------------------------------------------------------------------------
// PNG synthesis: deterministic gradient keyed by prompt, so different prompts
// produce visibly different images in the canvas.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const pngCache = new Map();

function makePng(width, height, seed) {
  const key = `${width}x${height}:${seed}`;
  const cached = pngCache.get(key);
  if (cached) return cached;
  const digest = createHash("sha256").update(seed).digest();
  const [r0, g0, b0, r1, g1, b1] = digest;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const o = y * stride + 1 + x * 3;
      raw[o] = Math.round(r0 + (r1 - r0) * t);
      raw[o + 1] = Math.round(g0 + (g1 - g0) * t);
      raw[o + 2] = Math.round(b0 + (b1 - b0) * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  if (pngCache.size > 32) pngCache.delete(pngCache.keys().next().value);
  pngCache.set(key, png);
  return png;
}

function sizeFromOpenAI(size) {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(size ?? ""));
  if (!m) return [1024, 1024];
  return [Math.min(4096, Number(m[1])), Math.min(4096, Number(m[2]))];
}

function sizeFromGemini(aspectRatio, imageSize) {
  const base = imageSize === "4K" ? 4096 : imageSize === "2K" ? 2048 : 1024;
  const m = /^(\d+):(\d+)$/.exec(String(aspectRatio ?? "1:1"));
  const ratio = m ? Number(m[1]) / Number(m[2]) : 1;
  const w = Math.round((base * Math.sqrt(ratio)) / 16) * 16;
  const h = Math.round(base / Math.sqrt(ratio) / 16) * 16;
  return [Math.max(64, w), Math.max(64, h)];
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

function directives(text) {
  const out = {};
  for (const m of String(text ?? "").matchAll(
    /\[\[mock:([a-z]+)(?:=([\w.-]+))?\]\]/gi,
  )) {
    out[m[1].toLowerCase()] = m[2] ?? true;
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": payload.length,
    ...headers,
  });
  res.end(payload);
}

function openaiError(
  res,
  status,
  message,
  code,
  type = "invalid_request_error",
) {
  sendJson(res, status, { error: { message, type, code, param: null } });
}

function geminiError(res, status, message) {
  const statusText =
    status === 429
      ? "RESOURCE_EXHAUSTED"
      : status === 401 || status === 403
        ? "PERMISSION_DENIED"
        : status === 404
          ? "NOT_FOUND"
          : status >= 500
            ? "INTERNAL"
            : "INVALID_ARGUMENT";
  sendJson(res, status, {
    error: { code: status, message, status: statusText },
  });
}

async function readBody(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY_BYTES)
      throw Object.assign(new Error("body too large"), { status: 413 });
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function parseMultipartFields(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!m) return { fields: {}, files: 0 };
  const boundary = `--${m[1] ?? m[2]}`;
  const fields = {};
  let files = 0;
  // latin1 keeps byte offsets stable for binary parts; text fields are re-decoded as utf8.
  for (const section of body.toString("latin1").split(boundary)) {
    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = section.slice(0, headerEnd);
    const name = /name="([^"]+)"/i.exec(headers)?.[1];
    if (!name) continue;
    if (/filename="/i.test(headers)) {
      files++;
      continue;
    }
    const value = section.slice(headerEnd + 4).replace(/\r\n$/, "");
    fields[name] = Buffer.from(value, "latin1").toString("utf8");
  }
  return { fields, files };
}

function bearer(req) {
  const h = req.headers.authorization ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

function authorized(req, url) {
  if (!UPSTREAM_KEY) return true;
  const presented =
    bearer(req) ||
    String(req.headers["x-goog-api-key"] ?? "") ||
    url.searchParams.get("key") ||
    "";
  return presented === UPSTREAM_KEY;
}

// ---------------------------------------------------------------------------
// OpenAI: chat completions (streaming + scripted tool calls)
// ---------------------------------------------------------------------------

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((p) =>
        typeof p === "string" ? p : (p?.text ?? p?.input_text ?? ""),
      )
      .join(" ");
  return "";
}

const IMAGE_INTENT = /(画|生成|图|海报|image|draw|picture|poster)/i;

// The app appends context blocks to the user's message (<canvas_state>,
// <input_images>, preferences). Intent, echo and prompt come from the user's
// own words only: "画布" in the canvas summary is not a request for an image.
function userWords(text) {
  return String(text ?? "")
    .replace(/<([a-z_]+)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .trim();
}

function imageCall(lastText, { badArgs = false } = {}) {
  const imageDelay = Number(directives(lastText).imagedelay);
  const prompt =
    (lastText
      .replace(/\[\[mock:[^\]]*\]\]/g, "")
      .trim()
      .slice(0, 400) || "lab image") +
    (imageDelay > 0 ? ` [[mock:delay=${imageDelay}]]` : "");
  return {
    kind: "tool",
    name: "generate_image",
    args: {
      title: prompt.slice(0, 24),
      prompt,
      aspectRatio: "1:1",
      quality: "standard",
      ...(badArgs ? { placementX: "left" } : {}),
    },
  };
}

// The server's answer when the tool's schema rejected the arguments
// (apps/server/src/agent/tool-errors.ts).
const ARGUMENT_ERROR = /参数不符合要求/;

// Decide what the scripted "model" does next: a generate_image tool call when
// the user asks for an image and the tool is offered, otherwise plain text.
// `toolOutputs` are the tool results since the last user message.
function planReply({ lastRole, lastText: fullText, toolNames, toolOutputs = [] }) {
  const lastText = userWords(fullText);
  if (lastRole === "tool") {
    const argumentErrors = toolOutputs.filter((t) => ARGUMENT_ERROR.test(t)).length;
    const lastOutput = toolOutputs.at(-1) ?? "";
    // Fix the call once, as a model would after reading the error.
    if (ARGUMENT_ERROR.test(lastOutput) && argumentErrors === 1 && toolNames.includes("generate_image"))
      return imageCall(lastText);
    if (ARGUMENT_ERROR.test(lastOutput))
      return { kind: "text", text: "（模拟上游）工具说参数不对，这次没有出图。" };
    return { kind: "text", text: "（模拟上游）图片已生成，已放到画布上。" };
  }
  if (toolNames.includes("generate_image") && IMAGE_INTENT.test(lastText)) {
    return imageCall(lastText, { badArgs: Boolean(directives(lastText).badtool) });
  }
  return { kind: "text", text: `（模拟上游）收到：${lastText.slice(0, 80)}` };
}

/** Tool results after the last user message, as text (chat completions). */
function chatToolOutputs(messages) {
  const lastUser = messages.findLastIndex((m) => m?.role === "user");
  return messages
    .slice(lastUser + 1)
    .filter((m) => m?.role === "tool")
    .map((m) => textOf(m.content));
}

function usageFor(text) {
  const completion = Math.max(1, Math.ceil(text.length / 4));
  return {
    prompt_tokens: 12,
    completion_tokens: completion,
    total_tokens: 12 + completion,
  };
}

async function handleChatCompletions(req, res, body, ctx) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages.at(-1) ?? {};
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  const lastText = textOf(lastUser?.content);
  const d = directives(lastText);
  ctx.directives = d;
  if (d.delay) await sleep(Number(d.delay));
  if (d.status)
    return openaiError(
      res,
      Number(d.status),
      `mock status ${d.status}`,
      `mock_${d.status}`,
    );
  if (d.safety)
    return openaiError(
      res,
      400,
      "Your request was rejected by the safety system.",
      "content_policy_violation",
    );

  const toolNames = (Array.isArray(body.tools) ? body.tools : [])
    .map((t) => t?.function?.name ?? t?.name)
    .filter(Boolean);
  const plan = planReply({
    lastRole: last.role,
    lastText,
    toolNames,
    toolOutputs: chatToolOutputs(messages),
  });
  ctx.plan = plan.kind;
  const id = `chatcmpl-mock-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? CHAT_MODELS[0];
  const text = d.empty ? "" : plan.kind === "text" ? plan.text : "";
  const toolCall =
    plan.kind === "tool"
      ? {
          id: `call_${randomUUID().slice(0, 8)}`,
          type: "function",
          function: { name: plan.name, arguments: JSON.stringify(plan.args) },
        }
      : null;
  const usage = usageFor(text || (toolCall?.function.arguments ?? ""));

  if (!body.stream) {
    return sendJson(res, 200, {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: toolCall ? null : text,
            ...(toolCall ? { tool_calls: [toolCall] } : {}),
          },
          finish_reason: toolCall ? "tool_calls" : "stop",
        },
      ],
      usage,
    });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const emit = (delta, finish = null, extra = {}) =>
    res.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`,
    );
  emit({ role: "assistant", content: "" });
  if (toolCall) {
    emit({
      tool_calls: [
        {
          index: 0,
          id: toolCall.id,
          type: "function",
          function: { name: toolCall.function.name, arguments: "" },
        },
      ],
    });
    const args = toolCall.function.arguments;
    for (let i = 0; i < args.length; i += 24)
      emit({
        tool_calls: [
          { index: 0, function: { arguments: args.slice(i, i + 24) } },
        ],
      });
    emit({}, "tool_calls");
  } else {
    for (const piece of text.match(/.{1,6}/gsu) ?? []) {
      emit({ content: piece });
      await sleep(15);
    }
    emit({}, "stop");
  }
  if (body.stream_options?.include_usage) {
    res.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage })}\n\n`,
    );
  }
  res.end("data: [DONE]\n\n");
}

// ---------------------------------------------------------------------------
// OpenAI: Responses API (minimal text + function_call, stream and non-stream)
// ---------------------------------------------------------------------------

function responsesInputText(input) {
  if (typeof input === "string") return { lastRole: "user", lastText: input };
  const items = Array.isArray(input) ? input : [];
  const last = items.at(-1) ?? {};
  const lastUser = [...items].reverse().find((i) => i?.role === "user");
  const lastRole =
    last.type === "function_call_output" ? "tool" : (last.role ?? "user");
  const lastUserIndex = items.findLastIndex((i) => i?.role === "user");
  const toolOutputs = items
    .slice(lastUserIndex + 1)
    .filter((i) => i?.type === "function_call_output")
    .map((i) => (typeof i.output === "string" ? i.output : textOf(i.output)));
  return { lastRole, lastText: textOf(lastUser?.content), toolOutputs };
}

async function handleResponses(req, res, body, ctx) {
  const { lastRole, lastText, toolOutputs } = responsesInputText(body.input);
  const d = directives(lastText);
  ctx.directives = d;
  if (d.delay) await sleep(Number(d.delay));
  if (d.status)
    return openaiError(
      res,
      Number(d.status),
      `mock status ${d.status}`,
      `mock_${d.status}`,
    );
  if (d.safety)
    return openaiError(
      res,
      400,
      "Your request was rejected by the safety system.",
      "content_policy_violation",
    );
  const toolNames = (Array.isArray(body.tools) ? body.tools : [])
    .map((t) => t?.name ?? t?.function?.name)
    .filter(Boolean);
  const plan = planReply({ lastRole, lastText, toolNames, toolOutputs });
  ctx.plan = plan.kind;
  const id = `resp_mock_${randomUUID().replaceAll("-", "")}`;
  const model = body.model ?? CHAT_MODELS[0];
  const text = d.empty ? "" : plan.kind === "text" ? plan.text : "";
  const item =
    plan.kind === "tool"
      ? {
          id: `fc_${randomUUID().slice(0, 8)}`,
          type: "function_call",
          status: "completed",
          call_id: `call_${randomUUID().slice(0, 8)}`,
          name: plan.name,
          arguments: JSON.stringify(plan.args),
        }
      : {
          id: `msg_${randomUUID().slice(0, 8)}`,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        };
  const u = usageFor(text || item.arguments || "");
  const usage = {
    input_tokens: u.prompt_tokens,
    output_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
  };
  const response = {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output: [item],
    usage,
  };
  if (!body.stream) return sendJson(res, 200, response);

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let seq = 0;
  const emit = (type, data) =>
    res.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`,
    );
  emit("response.created", {
    response: { ...response, status: "in_progress", output: [], usage: null },
  });
  if (item.type === "function_call") {
    emit("response.output_item.added", {
      output_index: 0,
      item: { ...item, arguments: "", status: "in_progress" },
    });
    emit("response.function_call_arguments.delta", {
      item_id: item.id,
      output_index: 0,
      delta: item.arguments,
    });
    emit("response.function_call_arguments.done", {
      item_id: item.id,
      output_index: 0,
      arguments: item.arguments,
    });
  } else {
    emit("response.output_item.added", {
      output_index: 0,
      item: { ...item, content: [], status: "in_progress" },
    });
    emit("response.content_part.added", {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    for (const piece of text.match(/.{1,6}/gsu) ?? []) {
      emit("response.output_text.delta", {
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: piece,
      });
      await sleep(15);
    }
    emit("response.output_text.done", {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text,
    });
    emit("response.content_part.done", {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: item.content[0],
    });
  }
  emit("response.output_item.done", { output_index: 0, item });
  emit("response.completed", { response });
  res.end();
}

// ---------------------------------------------------------------------------
// OpenAI: images
// ---------------------------------------------------------------------------

async function handleImages(req, res, raw, ctx, { edit }) {
  let params;
  if (edit && /multipart\/form-data/i.test(req.headers["content-type"] ?? "")) {
    const { fields, files } = parseMultipartFields(
      raw,
      req.headers["content-type"],
    );
    params = fields;
    ctx.inputFiles = files;
  } else {
    params = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  }
  ctx.model = params.model;
  const d = directives(params.prompt);
  ctx.directives = d;
  if (d.delay) await sleep(Number(d.delay));
  if (d.status)
    return openaiError(
      res,
      Number(d.status),
      `mock status ${d.status}`,
      `mock_${d.status}`,
    );
  // Real upstreams reject unknown image models; xy2api does not validate the
  // name itself, so this is what its users actually get back.
  if (params.model && !IMAGE_MODELS.includes(params.model))
    return openaiError(
      res,
      404,
      `The model \`${params.model}\` does not exist or you do not have access to it.`,
      "model_not_found",
    );
  if (d.safety)
    return openaiError(
      res,
      400,
      "Your request was rejected as a result of our safety system.",
      "moderation_blocked",
      "image_generation_user_error",
    );
  const n = Math.min(4, Math.max(1, Number(params.n ?? 1)));
  const [w, h] = sizeFromOpenAI(params.size);
  ctx.size = `${w}x${h}`;
  const data = d.empty
    ? []
    : Array.from({ length: n }, (_, i) => ({
        b64_json: makePng(w, h, `${params.prompt}#${i}`).toString("base64"),
      }));
  sendJson(res, 200, {
    created: Math.floor(Date.now() / 1000),
    data,
    background: "opaque",
    output_format: "png",
    quality: params.quality ?? "medium",
    size: `${w}x${h}`,
    usage: {
      input_tokens: 40,
      input_tokens_details: {
        image_tokens: ctx.inputFiles ? 256 : 0,
        text_tokens: 40,
      },
      output_tokens: 1056 * n,
      total_tokens: 40 + 1056 * n,
    },
  });
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

async function handleGeminiGenerate(req, res, body, ctx, model) {
  const parts = body.contents?.at(-1)?.parts ?? [];
  const prompt = parts.map((p) => p.text ?? "").join(" ");
  ctx.inputFiles = parts.filter((p) => p.inlineData).length;
  const d = directives(prompt);
  ctx.directives = d;
  if (d.delay) await sleep(Number(d.delay));
  if (d.status)
    return geminiError(res, Number(d.status), `mock status ${d.status}`);
  if (!GEMINI_MODELS.includes(model))
    return geminiError(
      res,
      404,
      `models/${model} is not found for API version v1beta, or is not supported for generateContent.`,
    );
  const usageMetadata = {
    promptTokenCount: 30,
    candidatesTokenCount: 1290,
    totalTokenCount: 1320,
  };
  if (d.safety)
    // Real blocked prompts report prompt tokens only (no candidates).
    return sendJson(res, 200, {
      promptFeedback: { blockReason: "SAFETY" },
      usageMetadata: { promptTokenCount: 30, totalTokenCount: 30 },
      modelVersion: model,
    });
  const cfg = body.generationConfig ?? body.config ?? {};
  const imageConfig = cfg.imageConfig ?? {};
  const [w, h] = sizeFromGemini(imageConfig.aspectRatio, imageConfig.imageSize);
  ctx.size = `${w}x${h}`;
  const contentParts = d.empty
    ? [{ text: "（模拟上游）没有图片" }]
    : [
        {
          inlineData: {
            mimeType: "image/png",
            data: makePng(w, h, prompt).toString("base64"),
          },
        },
      ];
  sendJson(res, 200, {
    candidates: [
      {
        content: { role: "model", parts: contentParts },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata,
    modelVersion: model,
    responseId: randomUUID(),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", "http://mock.local");
  const path = url.pathname;
  const ctx = { method: req.method, path, ua: req.headers["user-agent"] ?? "" };
  res.on("finish", () => {
    ctx.status = res.statusCode;
    ctx.ms = Date.now() - started;
    if (!path.startsWith("/__mock") && path !== "/healthz") {
      remember({ at: new Date(started).toISOString(), ...ctx });
      log("request", ctx);
    }
  });
  try {
    if (path === "/healthz") return sendJson(res, 200, { status: "ok" });
    if (path === "/__mock/requests") {
      if (req.method === "DELETE") recent.length = 0;
      return sendJson(res, 200, { requests: recent });
    }
    if (!authorized(req, url)) {
      return path.startsWith("/v1beta")
        ? geminiError(res, 401, "mock: invalid upstream key")
        : openaiError(
            res,
            401,
            "mock: invalid upstream key",
            "invalid_api_key",
            "authentication_error",
          );
    }

    if (req.method === "GET" && (path === "/v1/models" || path === "/models")) {
      const ids = [...CHAT_MODELS, ...IMAGE_MODELS];
      return sendJson(res, 200, {
        object: "list",
        data: ids.map((id) => ({
          id,
          object: "model",
          created: 1760000000,
          owned_by: "mock",
        })),
      });
    }
    if (req.method === "GET" && path === "/v1beta/models") {
      return sendJson(res, 200, {
        models: GEMINI_MODELS.map((m) => ({
          name: `models/${m}`,
          displayName: m,
          supportedGenerationMethods: ["generateContent"],
        })),
      });
    }

    const gemini =
      /^\/v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(
        path,
      );
    if (req.method === "POST" && gemini) {
      const raw = await readBody(req);
      ctx.model = gemini[1];
      return handleGeminiGenerate(
        req,
        res,
        raw.length ? JSON.parse(raw.toString("utf8")) : {},
        ctx,
        gemini[1],
      );
    }

    if (req.method !== "POST")
      return openaiError(
        res,
        404,
        `mock: no route ${req.method} ${path}`,
        "not_found",
      );
    const raw = await readBody(req);
    const p = path.replace(/^\/v1(?=\/)/, "");
    if (p === "/images/generations")
      return handleImages(req, res, raw, ctx, { edit: false });
    if (p === "/images/edits")
      return handleImages(req, res, raw, ctx, { edit: true });
    const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    ctx.model = body.model;
    ctx.stream = Boolean(body.stream);
    if (p === "/chat/completions")
      return handleChatCompletions(req, res, body, ctx);
    if (p === "/responses") return handleResponses(req, res, body, ctx);
    return openaiError(res, 404, `mock: no route POST ${path}`, "not_found");
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : String(error);
    if (res.headersSent) return res.end();
    const status = typeof error?.status === "number" ? error.status : 400;
    return openaiError(res, status, `mock: ${ctx.error}`, "mock_bad_request");
  }
});

server.listen(PORT, HOST, () => {
  log("listening", {
    host: HOST,
    port: PORT,
    keyRequired: Boolean(UPSTREAM_KEY),
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
