export const APP_TITLE = "Local Audio Plus";

export const AUDIO_EXTENSIONS = [
  "3gp",
  "aac",
  "amr",
  "flv",
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "ogg",
  "opus",
  "pcm",
  "wav",
  "webm",
  "wma"
];

export const MARKER_NAME = "local-audio-plus";

export const OPENAI_TRANSCRIPTION_MODELS = [
  {
    id: "gpt-4o-mini-transcribe",
    name: "GPT-4o mini Transcribe (lower cost)"
  },
  {
    id: "gpt-4o-transcribe",
    name: "GPT-4o Transcribe (higher accuracy)"
  }
];

export type ProviderId = "openai" | "tencent" | "xunfei";
export type OpenAIUploadFormat = "base64" | "formData";
export type TranscriptFormatting = "autoParagraphs" | "plain";
export type XunfeiLanguage = "autodialect" | "autominor";

export interface ProxySettings {
  enabled: boolean;
  url: string;
}

export interface OpenAISettings {
  apiKey: string;
  baseUrl: string;
  uploadFormat: OpenAIUploadFormat;
  transcriptionModel: string;
  diarizationModel: string;
  prompt: string;
}

export interface TencentSettings {
  secretId: string;
  secretKey: string;
  endpoint: string;
  region: string;
  engineModelType: string;
  channelNum: number;
  resTextFormat: number;
  pollIntervalSeconds: number;
  timeoutSeconds: number;
  hotwordList: string;
}

export interface XunfeiSettings {
  appId: string;
  apiKey: string;
  apiSecret: string;
  endpoint: string;
  language: XunfeiLanguage;
  pollIntervalSeconds: number;
  timeoutSeconds: number;
}

export interface LocalAudioPlusSettings {
  provider: ProviderId;
  automaticProcessing: boolean;
  processingIntervalSeconds: number;
  showNotifications: boolean;
  enabledExtensions: string;
  excludedFolders: string;
  language: string;
  enableDiarization: boolean;
  speakerCount: number;
  replaceExistingTranscripts: boolean;
  transcriptFormatting: TranscriptFormatting;
  proxy: ProxySettings;
  openai: OpenAISettings;
  tencent: TencentSettings;
  xunfei: XunfeiSettings;
}

export const DEFAULT_SETTINGS: LocalAudioPlusSettings = {
  provider: "openai",
  automaticProcessing: false,
  processingIntervalSeconds: 10,
  showNotifications: true,
  enabledExtensions: AUDIO_EXTENSIONS.join("|"),
  excludedFolders: "",
  language: "",
  enableDiarization: true,
  speakerCount: 0,
  replaceExistingTranscripts: false,
  transcriptFormatting: "autoParagraphs",
  proxy: {
    enabled: false,
    url: ""
  },
  openai: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    uploadFormat: "base64",
    transcriptionModel: "gpt-4o-mini-transcribe",
    diarizationModel: "gpt-4o-transcribe-diarize",
    prompt: ""
  },
  tencent: {
    secretId: "",
    secretKey: "",
    endpoint: "https://asr.tencentcloudapi.com",
    region: "ap-shanghai",
    engineModelType: "16k_zh_en",
    channelNum: 1,
    resTextFormat: 3,
    pollIntervalSeconds: 15,
    timeoutSeconds: 10800,
    hotwordList: ""
  },
  xunfei: {
    appId: "",
    apiKey: "",
    apiSecret: "",
    endpoint: "https://office-api-ist-dx.iflyaisol.com",
    language: "autodialect",
    pollIntervalSeconds: 15,
    timeoutSeconds: 10800
  }
};
