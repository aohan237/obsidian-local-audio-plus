import { createHash, createHmac } from "crypto";
import { requestWithProxy } from "../request";
import { TranscriptResult, TranscriptSegment, TranscriptionContext, TranscriptionProvider } from "../types";
import { LocalAudioPlusSettings, TencentSettings } from "../config";

const API_VERSION = "2019-06-14";
const ALGORITHM = "TC3-HMAC-SHA256";
const CONTENT_TYPE = "application/json; charset=utf-8";
const DEFAULT_ENDPOINT = "https://asr.tencentcloudapi.com";
const SERVICE = "asr";
const MAX_LOCAL_UPLOAD_BYTES = 5 * 1024 * 1024;

export class TencentProvider implements TranscriptionProvider {
  id = "tencent" as const;
  name = "Tencent Cloud ASR";

  async transcribe(context: TranscriptionContext): Promise<TranscriptResult> {
    const settings = context.settings.tencent;
    if (!settings.secretId.trim() || !settings.secretKey.trim()) {
      throw new Error("Tencent Cloud SecretId and SecretKey are required.");
    }

    if (context.audioData.byteLength > MAX_LOCAL_UPLOAD_BYTES) {
      throw new Error(
        `Tencent Cloud local audio upload is limited to 5 MB. This file is ${formatBytes(context.audioData.byteLength)}.`
      );
    }

    const taskId = await createTask(context);
    const startedAt = Date.now();

    while (true) {
      const result = await describeTask(context.settings, taskId);
      const response = asRecord(result.Response);
      const data = asRecord(response.Data);
      const status = readNumber(data.Status);

      if (status === 2) {
        return normalizeTencentResult(data, result, settings.engineModelType.trim());
      }

      if (status === 3) {
        const errorMessage = readString(data.ErrorMsg) || readString(data.StatusStr) || "task failed";
        throw new Error(`Tencent Cloud ASR task failed: ${errorMessage}`);
      }

      if (Date.now() - startedAt > settings.timeoutSeconds * 1000) {
        throw new Error("Tencent Cloud ASR task timed out.");
      }

      await sleep(settings.pollIntervalSeconds * 1000);
    }
  }
}

async function createTask(context: TranscriptionContext): Promise<number> {
  const settings = context.settings.tencent;
  const engineModelType = settings.engineModelType.trim() || "16k_zh_en";
  const payload: Record<string, unknown> = {
    ChannelNum: settings.channelNum,
    EngineModelType: engineModelType,
    ResTextFormat: settings.resTextFormat,
    SourceType: 1,
    Data: Buffer.from(context.audioData).toString("base64"),
    DataLen: context.audioData.byteLength
  };

  if (context.settings.enableDiarization) {
    payload.SpeakerDiarization = 1;
    if (context.settings.speakerCount > 0 && engineModelType.startsWith("8k_")) {
      payload.SpeakerNumber = context.settings.speakerCount;
    }
  } else {
    payload.SpeakerDiarization = 0;
  }

  if (settings.hotwordList.trim()) {
    payload.HotwordList = settings.hotwordList.trim();
  }

  const result = await callTencentApi(context.settings, "CreateRecTask", payload);
  const response = asRecord(result.Response);
  const data = asRecord(response.Data);
  const taskId = readNumber(data.TaskId);
  if (taskId === undefined) {
    throw new Error("Tencent Cloud ASR create task response did not include TaskId.");
  }
  return taskId;
}

async function describeTask(settings: LocalAudioPlusSettings, taskId: number): Promise<Record<string, unknown>> {
  return callTencentApi(settings, "DescribeTaskStatus", { TaskId: taskId });
}

async function callTencentApi(
  settings: LocalAudioPlusSettings,
  action: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const tencentSettings = settings.tencent;
  const endpoint = normalizeEndpoint(tencentSettings.endpoint);
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = createAuthorization(tencentSettings, action, endpoint.host, body, timestamp);
  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": CONTENT_TYPE,
    Host: endpoint.host,
    "X-TC-Action": action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": API_VERSION
  };

  if (tencentSettings.region.trim()) {
    headers["X-TC-Region"] = tencentSettings.region.trim();
  }

  const response = await requestWithProxy(settings, {
    url: endpoint.url,
    method: "POST",
    contentType: CONTENT_TYPE,
    headers,
    body,
    throw: false
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Tencent Cloud ${action} failed (${response.status}): ${response.text}`);
  }

  const json = parseJson(response.json, response.text);
  const apiResponse = asRecord(asRecord(json).Response);
  const apiError = asRecord(apiResponse.Error);
  const code = readString(apiError.Code);
  if (code) {
    throw new Error(`Tencent Cloud ${action} failed (${code}): ${readString(apiError.Message)}`);
  }

  return json;
}

function createAuthorization(
  settings: TencentSettings,
  action: string,
  host: string,
  payload: string,
  timestamp: number
): string {
  const date = utcDate(timestamp);
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload)
  ].join("\n");
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    ALGORITHM,
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const secretDate = hmacSha256(Buffer.from(`TC3${settings.secretKey.trim()}`, "utf8"), date);
  const secretService = hmacSha256(secretDate, SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign).toString("hex");

  return `${ALGORITHM} Credential=${settings.secretId.trim()}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function normalizeTencentResult(data: Record<string, unknown>, raw: unknown, model: string): TranscriptResult {
  const segments = normalizeResultDetail(data.ResultDetail);
  const text = segments.length > 0
    ? segments.map((segment) => segment.text).join("\n")
    : cleanTencentResultText(readString(data.Result));

  return {
    provider: "tencent",
    model,
    text,
    segments: segments.length > 0 ? segments : text ? [{ text }] : [],
    raw
  };
}

function normalizeResultDetail(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  const segments: TranscriptSegment[] = [];

  for (const item of value) {
    const record = asRecord(item);
    const text = readString(record.FinalSentence) || readString(record.SliceSentence);
    if (!text.trim()) continue;

    const speakerId = readNumber(record.SpeakerId);
    segments.push({
      speaker: speakerId === undefined ? undefined : `Speaker ${speakerId + 1}`,
      text: text.trim(),
      startMs: readNumber(record.StartMs),
      endMs: readNumber(record.EndMs)
    });
  }

  return segments;
}

function cleanTencentResultText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeEndpoint(value: string): { url: string; host: string } {
  const raw = value.trim() || DEFAULT_ENDPOINT;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return {
    url: url.toString(),
    host: url.host
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function utcDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseJson(jsonValue: unknown, text: string): Record<string, unknown> {
  if (jsonValue && typeof jsonValue === "object") return jsonValue as Record<string, unknown>;
  return JSON.parse(text) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
