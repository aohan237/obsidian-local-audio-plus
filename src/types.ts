import { App, TFile } from "obsidian";
import { LocalAudioPlusSettings, ProviderId } from "./config";

export interface TranscriptSegment {
  speaker?: string;
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface TranscriptResult {
  provider: ProviderId;
  model?: string;
  text: string;
  segments: TranscriptSegment[];
  raw?: unknown;
}

export interface TranscriptionContext {
  app: App;
  noteFile: TFile;
  audioFile: TFile;
  audioData: ArrayBuffer;
  audioHash: string;
  settings: LocalAudioPlusSettings;
}

export interface TranscriptionProvider {
  id: ProviderId;
  name: string;
  transcribe(context: TranscriptionContext): Promise<TranscriptResult>;
}

export interface AudioLinkMatch {
  fullText: string;
  rawTarget: string;
  index: number;
  isEmbed: boolean;
}

export interface TranscriptBlock {
  start: number;
  end: number;
  filePath: string;
  hash?: string;
  provider?: ProviderId;
}
