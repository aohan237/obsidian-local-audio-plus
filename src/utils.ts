import { Notice, TFile, normalizePath } from "obsidian";
import { createHash, randomBytes } from "crypto";
import { APP_TITLE, MARKER_NAME } from "./config";
import { AudioLinkMatch, TranscriptBlock } from "./types";

export function notify(message: string, enabled: boolean, timeout?: number): void {
  if (enabled) {
    new Notice(`${APP_TITLE}\n${message}`, timeout);
  }
}

export function getExtension(path: string): string {
  const cleanPath = path.split("?")[0].split("#")[0];
  const index = cleanPath.lastIndexOf(".");
  return index === -1 ? "" : cleanPath.slice(index + 1).toLowerCase();
}

export function extensionSet(value: string): Set<string> {
  return new Set(
    value
      .split("|")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isProbablyRemote(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target) && !target.startsWith("file://");
}

export function cleanLinkTarget(rawTarget: string): string {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  target = target.split("#")[0].split("|")[0].trim();
  if (target.startsWith("file://")) {
    return target;
  }
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

export function findAudioLinks(content: string): AudioLinkMatch[] {
  const matches: AudioLinkMatch[] = [];
  const wikiPattern = /!?\[\[([^\]\n]+)\]\]/g;
  const markdownPattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;

  for (const match of content.matchAll(wikiPattern)) {
    matches.push({
      fullText: match[0],
      rawTarget: match[1],
      index: match.index ?? 0,
      isEmbed: match[0].startsWith("!")
    });
  }

  for (const match of content.matchAll(markdownPattern)) {
    matches.push({
      fullText: match[0],
      rawTarget: stripMarkdownTitle(match[1]),
      index: match.index ?? 0,
      isEmbed: match[0].startsWith("!")
    });
  }

  return matches.sort((a, b) => a.index - b.index);
}

export function resolveVaultAudioFile(
  noteFile: TFile,
  target: string,
  getFirstLinkpathDest: (linkpath: string, sourcePath: string) => TFile | null
): TFile | null {
  if (isProbablyRemote(target) || target.startsWith("file://")) {
    return null;
  }

  const linkDest = getFirstLinkpathDest(target, noteFile.path);
  if (linkDest instanceof TFile) {
    return linkDest;
  }

  return null;
}

export function isExcluded(path: string, excludedFolders: string): boolean {
  const normalized = normalizePath(path);
  return excludedFolders
    .split("\n")
    .map((item) => normalizePath(item.trim()).replace(/\/+$/, ""))
    .filter(Boolean)
    .some((folder) => normalized === folder || normalized.startsWith(`${folder}/`));
}

export function sha256Hex(data: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(data)).digest("hex");
}

export function randomAlphaNumeric(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let result = "";
  for (const byte of bytes) {
    result += alphabet[byte % alphabet.length];
  }
  return result;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

export function formatTime(ms?: number): string {
  if (ms === undefined || Number.isNaN(ms)) return "";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function findTranscriptBlock(content: string, filePath: string): TranscriptBlock | null {
  const pattern = new RegExp(
    `<!--\\s*${MARKER_NAME}:start\\s+([^>]*)-->[\\s\\S]*?<!--\\s*${MARKER_NAME}:end\\s*-->`,
    "g"
  );

  for (const match of content.matchAll(pattern)) {
    const attrs = parseMarkerAttributes(match[1]);
    if (attrs.file && decodeMarkerValue(attrs.file) === filePath) {
      return {
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        filePath,
        hash: attrs.hash,
        provider: attrs.provider as TranscriptBlock["provider"]
      };
    }
  }

  return null;
}

export function markerStart(filePath: string, hash: string, provider: string): string {
  return `<!-- ${MARKER_NAME}:start file="${encodeMarkerValue(filePath)}" hash="${hash}" provider="${provider}" -->`;
}

export function markerEnd(): string {
  return `<!-- ${MARKER_NAME}:end -->`;
}

function stripMarkdownTitle(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  const quoteIndex = Math.min(
    positiveIndexOrInfinity(trimmed.indexOf(' "')),
    positiveIndexOrInfinity(trimmed.indexOf(" '"))
  );
  if (quoteIndex !== Infinity) {
    return trimmed.slice(0, quoteIndex).trim();
  }
  return trimmed;
}

function positiveIndexOrInfinity(index: number): number {
  return index >= 0 ? index : Infinity;
}

function parseMarkerAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  for (const match of value.matchAll(pattern)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function encodeMarkerValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeMarkerValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
