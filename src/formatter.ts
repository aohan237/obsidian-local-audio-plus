import { TFile } from "obsidian";
import { TranscriptFormatting } from "./config";
import { markerEnd, markerStart, formatTime } from "./utils";
import { TranscriptResult, TranscriptSegment } from "./types";

export function formatTranscriptBlock(
  audioFile: TFile,
  audioHash: string,
  result: TranscriptResult,
  formatting: TranscriptFormatting = "autoParagraphs"
): string {
  const lines: string[] = [
    markerStart(audioFile.path, audioHash, result.provider),
    `> [!quote]- Transcript: ${audioFile.name}`,
    `> Provider: ${providerName(result.provider)}${result.model ? ` / ${result.model}` : ""}`,
    ">"
  ];

  const segments = result.segments.length > 0 ? result.segments : [{ text: result.text }];
  for (const segment of segments) {
    appendSegment(lines, segment, formatting);
  }

  lines.push(markerEnd());
  return lines.join("\n");
}

function appendSegment(lines: string[], segment: TranscriptSegment, formatting: TranscriptFormatting): void {
  const speaker = segment.speaker ?? "Transcript";
  const timeRange = formatRange(segment.startMs, segment.endMs);
  const prefix = timeRange ? `> **${speaker}** \`${timeRange}\`` : `> **${speaker}**`;
  lines.push(prefix);

  const textLines = formatTranscriptText(segment.text, formatting);
  if (textLines.length === 0) {
    lines.push("> ");
  } else {
    textLines.forEach((line, index) => {
      if (index > 0 && formatting === "autoParagraphs") {
        lines.push(">");
      }
      lines.push(`> ${line}`);
    });
  }
  lines.push(">");
}

function formatTranscriptText(text: string, formatting: TranscriptFormatting): string[] {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (formatting === "plain") return lines;

  const paragraphs: string[] = [];
  for (const line of lines) {
    paragraphs.push(...splitIntoParagraphs(line));
  }
  return paragraphs;
}

function splitIntoParagraphs(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const paragraphs: string[] = [];
  let paragraph = "";
  let sentenceCount = 0;

  for (const char of normalized) {
    paragraph += char;
    if (!isSentenceEnd(char)) continue;

    sentenceCount++;
    if (sentenceCount >= 2 || paragraph.length >= 160) {
      paragraphs.push(paragraph.trim());
      paragraph = "";
      sentenceCount = 0;
    }
  }

  if (paragraph.trim()) {
    paragraphs.push(paragraph.trim());
  }

  return paragraphs;
}

function isSentenceEnd(char: string): boolean {
  return /[。！？!?；;]/.test(char);
}

function formatRange(startMs?: number, endMs?: number): string {
  if (startMs === undefined && endMs === undefined) return "";
  const start = formatTime(startMs);
  const end = formatTime(endMs);
  return end ? `${start}-${end}` : start;
}

function providerName(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "tencent") return "Tencent Cloud ASR";
  return provider;
}
