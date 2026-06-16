import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import {
  editorInfoField,
  editorLivePreviewField,
  Editor,
  MarkdownPostProcessorContext,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  setIcon,
  setTooltip,
  TAbstractFile,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import { APP_TITLE, DEFAULT_SETTINGS, LocalAudioPlusSettings } from "./config";
import { formatTranscriptBlock } from "./formatter";
import { t } from "./i18n";
import { createProvider } from "./providers";
import { LocalAudioPlusSettingTab } from "./settingsTab";
import { AudioLinkMatch } from "./types";
import { UniqueQueue } from "./uniqueQueue";
import {
  cleanLinkTarget,
  extensionSet,
  findAudioLinks,
  findTranscriptBlock,
  findTranscriptBlockByHash,
  getExtension,
  isExcluded,
  notify,
  resolveVaultAudioFile,
  sha256Hex
} from "./utils";

export default class LocalAudioPlusPlugin extends Plugin {
  settings!: LocalAudioPlusSettings;
  private modifiedQueue = new UniqueQueue<TFile>();
  private intervalId = 0;
  private processingNotes = new Set<TFile>();
  private processingAudioHashes = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("file-audio", APP_TITLE, () => {
      void this.processActiveNote();
    });

    this.addCommand({
      id: "transcribe-current-note",
      name: t("command.transcribeCurrentNote"),
      callback: () => {
        void this.processActiveNote();
      }
    });

    this.addCommand({
      id: "transcribe-all-notes",
      name: t("command.transcribeAllNotes"),
      callback: () => {
        void this.processAllNotes();
      }
    });

    this.addCommand({
      id: "diagnose-current-note",
      name: t("command.diagnoseCurrentNote"),
      callback: () => {
        void this.diagnoseActiveNote();
      }
    });

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.addAudioLinkButtons(el, ctx);
    });

    this.registerEditorExtension(createEditorAudioLinkButtonExtension(this));

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        this.addEditorAudioMenuItem(menu, editor, info.file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        this.addAudioFileMenuItem(menu, file, leaf);
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.settings.automaticProcessing || !(file instanceof TFile) || file.extension !== "md") return;
        if (this.processingNotes.has(file)) return;
        if (this.isPathExcluded(file)) return;
        this.modifiedQueue.push(file, 1);
      })
    );

    this.setupQueueInterval();
    this.addSettingTab(new LocalAudioPlusSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = 0;
    }
  }

  setupQueueInterval(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = 0;
    }

    if (!this.settings.automaticProcessing) {
      this.modifiedQueue.clear();
      return;
    }

    if (this.settings.automaticProcessing && this.settings.processingIntervalSeconds > 0) {
      this.intervalId = window.setInterval(
        () => void this.processModifiedQueue(),
        this.settings.processingIntervalSeconds * 1000
      );
      this.registerInterval(this.intervalId);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async processActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) {
      notify("Open a markdown note first.", this.settings.showNotifications, 10000);
      return;
    }
    await this.processNote(file);
  }

  private async diagnoseActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) {
      notify("Open a markdown note first.", this.settings.showNotifications, 10000);
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const report = this.collectAudioTargets(file, content);
    notify(
      [
        `Scanned ${report.totalLinks} markdown/wiki link(s).`,
        `Found ${report.targets.length} supported local audio file(s).`,
        report.unsupportedCount ? `Skipped ${report.unsupportedCount} unsupported/non-local link(s).` : "",
        report.existingTranscriptCount ? `Found ${report.existingTranscriptCount} existing transcript block(s).` : "",
        `Provider: ${this.settings.provider}`
      ]
        .filter(Boolean)
        .join("\n"),
      this.settings.showNotifications,
      15000
    );
  }

  private async processAllNotes(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isPathExcluded(file));
    const notice = this.settings.showNotifications
      ? new Notice(`${APP_TITLE}\nProcessing ${files.length} notes...`, 0)
      : null;

    try {
      for (const [index, file] of files.entries()) {
        notice?.setMessage(`${APP_TITLE}\nProcessing ${index + 1}/${files.length}: ${file.path}`);
        await this.processNote(file, false);
      }
      notice?.setMessage(`${APP_TITLE}\nFinished processing ${files.length} notes.`);
    } finally {
      if (notice) {
        window.setTimeout(() => notice.hide(), 5000);
      }
    }
  }

  private async processModifiedQueue(): Promise<void> {
    if (!this.settings.automaticProcessing) {
      this.modifiedQueue.clear();
      return;
    }

    const iteration = this.modifiedQueue.iterationQueue();
    for (const file of iteration) {
      if (!this.settings.automaticProcessing) {
        this.modifiedQueue.clear();
        return;
      }
      await this.processNote(file, false);
    }
  }

  private async processNote(noteFile: TFile, showNoChangeNotice = true): Promise<void> {
    if (this.processingNotes.has(noteFile)) return;
    if (noteFile.extension !== "md" || this.isPathExcluded(noteFile)) return;

    this.processingNotes.add(noteFile);
    try {
      const content = await this.app.vault.cachedRead(noteFile);
      const report = this.collectAudioTargets(noteFile, content);
      const provider = createProvider(this.settings.provider);

      if (report.targets.length > 0) {
        notify(
          `Found ${report.targets.length} local audio file(s). Using ${provider.name} in the background...`,
          this.settings.showNotifications,
          10000
        );
      }

      const result = createProcessingSummary();
      for (const { audioFile } of report.targets) {
        const status = await this.transcribeAudioTarget(noteFile, audioFile);
        result[status]++;
      }

      const changedCount = result.inserted + result.replaced;
      if (changedCount > 0) {
        notify(
          `Updated ${changedCount} transcript block(s) in ${noteFile.path}.`,
          this.settings.showNotifications,
          10000
        );
      } else if (showNoChangeNotice) {
        notify(
          `No new transcript was inserted in ${noteFile.path}.\nUse "Diagnose local audio in current note" for details.`,
          this.settings.showNotifications,
          12000
        );
      }
    } catch (error) {
      notify(`Transcription failed for ${noteFile.path}:\n${errorMessage(error)}`, this.settings.showNotifications, 20000);
      console.error(APP_TITLE, error);
    } finally {
      this.processingNotes.delete(noteFile);
    }
  }

  private async processSingleAudioFile(noteFile: TFile, audioFile: TFile): Promise<void> {
    if (noteFile.extension !== "md") {
      notify("Choose a markdown note before transcribing an audio link.", this.settings.showNotifications, 10000);
      return;
    }

    if (this.isPathExcluded(noteFile)) return;

    if (!this.isSupportedAudioFile(audioFile)) {
      notify(`${audioFile.path} is not in the enabled audio extension list.`, this.settings.showNotifications, 10000);
      return;
    }

    if (this.processingNotes.has(noteFile)) {
      notify(`A transcription task is already running for ${noteFile.path}.`, this.settings.showNotifications, 10000);
      return;
    }

    this.processingNotes.add(noteFile);
    try {
      notify(`Transcribing ${audioFile.path} in the background...`, this.settings.showNotifications, 10000);
      const status = await this.transcribeAudioTarget(noteFile, audioFile);
      this.notifySingleAudioResult(noteFile, audioFile, status);
    } catch (error) {
      notify(`Transcription failed for ${audioFile.path}:\n${errorMessage(error)}`, this.settings.showNotifications, 20000);
      console.error(APP_TITLE, error);
    } finally {
      this.processingNotes.delete(noteFile);
    }
  }

  async processAudioLink(noteFile: TFile, rawTarget: string): Promise<void> {
    const audioFile = this.resolveRawAudioTarget(noteFile, rawTarget);
    if (!audioFile) {
      notify(`No supported local audio file was found for ${rawTarget}.`, this.settings.showNotifications, 10000);
      return;
    }

    await this.processSingleAudioFile(noteFile, audioFile);
  }

  isTranscribableAudioLinkTarget(noteFile: TFile, rawTarget: string): boolean {
    return !this.isPathExcluded(noteFile) && this.resolveRawAudioTarget(noteFile, rawTarget) !== null;
  }

  private async transcribeAudioTarget(noteFile: TFile, audioFile: TFile): Promise<TranscriptWriteStatus> {
    const provider = createProvider(this.settings.provider);
    const preflightContent = await this.app.vault.read(noteFile);
    const existingBlock = findTranscriptBlock(preflightContent, audioFile.path);
    const targetStillExists = this.findAudioTargetForFile(noteFile, preflightContent, audioFile) !== null;

    if (existingBlock && !this.settings.replaceExistingTranscripts) {
      return "skipped";
    }

    if (!existingBlock && !targetStillExists) {
      return "missingLink";
    }

    const audioData = await this.app.vault.adapter.readBinary(audioFile.path);
    const audioHash = sha256Hex(audioData);
    const existingHashBlock = existingBlock ?? findTranscriptBlockByHash(preflightContent, audioHash);

    if (existingHashBlock?.hash === audioHash) {
      return "skipped";
    }

    if (this.processingAudioHashes.has(audioHash)) {
      return "alreadyProcessing";
    }

    this.processingAudioHashes.add(audioHash);
    try {
      const transcript = await provider.transcribe({
        app: this.app,
        noteFile,
        audioFile,
        audioData,
        audioHash,
        settings: this.settings
      });
      const block = formatTranscriptBlock(audioFile, audioHash, transcript, this.settings.transcriptFormatting);

      return this.writeTranscriptBlock(noteFile, audioFile, audioHash, block);
    } finally {
      this.processingAudioHashes.delete(audioHash);
    }
  }

  private async writeTranscriptBlock(
    noteFile: TFile,
    audioFile: TFile,
    audioHash: string,
    block: string
  ): Promise<TranscriptWriteStatus> {
    let status: TranscriptWriteStatus = "skipped";

    await this.app.vault.process(noteFile, (content) => {
      const existingBlock = findTranscriptBlock(content, audioFile.path);
      if (existingBlock) {
        if (!this.settings.replaceExistingTranscripts || existingBlock.hash === audioHash) {
          status = "skipped";
          return content;
        }

        status = "replaced";
        return `${content.slice(0, existingBlock.start)}${block}${content.slice(existingBlock.end)}`;
      }

      const existingHashBlock = findTranscriptBlockByHash(content, audioHash);
      if (existingHashBlock) {
        status = "skipped";
        return content;
      }

      const target = this.findAudioTargetForFile(noteFile, content, audioFile);
      if (!target) {
        status = "missingLink";
        return content;
      }

      const insertAt = target.link.index + target.link.fullText.length;
      status = "inserted";
      return `${content.slice(0, insertAt)}\n\n${block}${content.slice(insertAt)}`;
    });

    return status;
  }

  private collectAudioTargets(
    noteFile: TFile,
    content: string
  ): {
    totalLinks: number;
    targets: { link: AudioLinkMatch; audioFile: TFile }[];
    unsupportedCount: number;
    existingTranscriptCount: number;
  } {
    const enabledExtensions = extensionSet(this.settings.enabledExtensions);
    const audioLinks = findAudioLinks(content);
    const byPath = new Map<string, { link: AudioLinkMatch; audioFile: TFile }>();
    let unsupportedCount = 0;

    for (const link of audioLinks) {
      const audioFile = this.resolveAudioLink(noteFile, link, enabledExtensions);
      if (!audioFile) {
        unsupportedCount++;
        continue;
      }

      const existing = byPath.get(audioFile.path);
      if (!existing || (!existing.link.isEmbed && link.isEmbed)) {
        byPath.set(audioFile.path, { link, audioFile });
      }
    }

    const targets = Array.from(byPath.values()).sort((a, b) => a.link.index - b.link.index);
    const existingTranscriptCount = targets.filter(({ audioFile }) => findTranscriptBlock(content, audioFile.path)).length;

    return {
      totalLinks: audioLinks.length,
      targets,
      unsupportedCount,
      existingTranscriptCount
    };
  }

  private resolveAudioLink(noteFile: TFile, link: AudioLinkMatch, enabledExtensions: Set<string>): TFile | null {
    const target = cleanLinkTarget(link.rawTarget);
    const extension = getExtension(target);
    if (!enabledExtensions.has(extension)) return null;

    return resolveVaultAudioFile(noteFile, target, (linkpath, sourcePath) => {
      const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      return file instanceof TFile ? file : null;
    });
  }

  private resolveRawAudioTarget(noteFile: TFile, rawTarget: string): TFile | null {
    const link: AudioLinkMatch = {
      fullText: rawTarget,
      rawTarget,
      index: 0,
      isEmbed: false
    };
    return this.resolveAudioLink(noteFile, link, extensionSet(this.settings.enabledExtensions));
  }

  private findAudioTargetForFile(
    noteFile: TFile,
    content: string,
    audioFile: TFile
  ): { link: AudioLinkMatch; audioFile: TFile } | null {
    return (
      this.collectAudioTargets(noteFile, content).targets.find(
        (target) => target.audioFile === audioFile || target.audioFile.path === audioFile.path
      ) ?? null
    );
  }

  private addAudioLinkButtons(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const noteFile = this.getMarkdownFileByPath(ctx.sourcePath);
    if (!noteFile || this.isPathExcluded(noteFile)) return;

    const anchors = Array.from(el.querySelectorAll<HTMLAnchorElement>("a.internal-link, a[data-href], a[href]"));
    for (const anchor of anchors) {
      if (anchor.closest(".local-audio-plus-transcript")) continue;
      if (anchor.nextElementSibling?.classList.contains("local-audio-plus-transcribe-button")) continue;

      const rawTarget = this.getRenderedLinkTarget(anchor);
      if (!rawTarget || !this.resolveRawAudioTarget(noteFile, rawTarget)) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "clickable-icon local-audio-plus-transcribe-button";
      button.setAttribute("aria-label", t("action.transcribeAudio"));
      setIcon(button, "file-audio");
      setTooltip(button, t("action.transcribeAudio"));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.processAudioLink(noteFile, rawTarget);
      });
      anchor.insertAdjacentElement("afterend", button);
    }
  }

  private addEditorAudioMenuItem(menu: Menu, editor: Editor, noteFile: TFile | null): void {
    if (!noteFile || noteFile.extension !== "md" || this.isPathExcluded(noteFile)) return;

    const target = this.findAudioTargetAtEditorCursor(noteFile, editor);
    if (!target) return;

    menu.addItem((item) => {
      item
        .setTitle(t("menu.transcribeThisAudio"))
        .setIcon("file-audio")
        .onClick(() => {
          void this.processSingleAudioFile(noteFile, target.audioFile);
        });
    });
  }

  private addAudioFileMenuItem(menu: Menu, file: TAbstractFile, leaf?: WorkspaceLeaf): void {
    if (!(file instanceof TFile) || !this.isSupportedAudioFile(file)) return;

    const noteFile = this.getMarkdownFileFromLeaf(leaf) ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
    if (!noteFile || noteFile.extension !== "md" || this.isPathExcluded(noteFile)) return;

    menu.addItem((item) => {
      item
        .setTitle(t("menu.transcribeThisAudioInCurrentNote"))
        .setIcon("file-audio")
        .onClick(() => {
          void this.processSingleAudioFile(noteFile, file);
        });
    });
  }

  private findAudioTargetAtEditorCursor(
    noteFile: TFile,
    editor: Editor
  ): { link: AudioLinkMatch; audioFile: TFile } | null {
    const content = editor.getValue();
    const cursorOffset = editor.posToOffset(editor.getCursor());
    const enabledExtensions = extensionSet(this.settings.enabledExtensions);

    for (const link of findAudioLinks(content)) {
      const start = link.index;
      const end = link.index + link.fullText.length;
      if (cursorOffset < start || cursorOffset > end) continue;

      const audioFile = this.resolveAudioLink(noteFile, link, enabledExtensions);
      if (audioFile) {
        return { link, audioFile };
      }
    }

    return null;
  }

  private getRenderedLinkTarget(anchor: HTMLAnchorElement): string | null {
    const dataHref = anchor.getAttribute("data-href");
    if (dataHref) return dataHref;

    const href = anchor.getAttribute("href");
    if (!href) return null;

    try {
      const url = new URL(href);
      const fileParam = url.searchParams.get("file");
      if (fileParam) return fileParam;
      if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:") return href;
      return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return href;
    }
  }

  private getMarkdownFileByPath(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && file.extension === "md" ? file : null;
  }

  private getMarkdownFileFromLeaf(leaf?: WorkspaceLeaf): TFile | null {
    const view = leaf?.view;
    return view instanceof MarkdownView ? view.file : null;
  }

  private isSupportedAudioFile(file: TFile): boolean {
    return extensionSet(this.settings.enabledExtensions).has(file.extension.toLowerCase());
  }

  private notifySingleAudioResult(noteFile: TFile, audioFile: TFile, status: TranscriptWriteStatus): void {
    if (status === "inserted") {
      notify(`Inserted transcript for ${audioFile.name} in ${noteFile.path}.`, this.settings.showNotifications, 10000);
      return;
    }

    if (status === "replaced") {
      notify(`Replaced transcript for ${audioFile.name} in ${noteFile.path}.`, this.settings.showNotifications, 10000);
      return;
    }

    if (status === "missingLink") {
      notify(
        `Finished transcribing ${audioFile.name}, but the audio link was no longer found in ${noteFile.path}.`,
        this.settings.showNotifications,
        15000
      );
      return;
    }

    if (status === "alreadyProcessing") {
      notify(`${audioFile.name} is already being transcribed.`, this.settings.showNotifications, 10000);
      return;
    }

    notify(`No transcript update was needed for ${audioFile.name}.`, this.settings.showNotifications, 10000);
  }

  private isPathExcluded(file: TFile): boolean {
    return isExcluded(file.parent?.path ?? "", this.settings.excludedFolders);
  }
}

function createEditorAudioLinkButtonExtension(plugin: LocalAudioPlusPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildEditorAudioLinkButtonDecorations(plugin, view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildEditorAudioLinkButtonDecorations(plugin, update.view);
        }
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function buildEditorAudioLinkButtonDecorations(plugin: LocalAudioPlusPlugin, view: EditorView): DecorationSet {
  const livePreview = view.state.field(editorLivePreviewField, false);
  const info = view.state.field(editorInfoField, false);
  const noteFile = info?.file;
  if (!livePreview || !noteFile || noteFile.extension !== "md") {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    for (const link of findAudioLinks(text)) {
      if (!plugin.isTranscribableAudioLinkTarget(noteFile, link.rawTarget)) continue;
      builder.add(
        range.from + link.index + link.fullText.length,
        range.from + link.index + link.fullText.length,
        Decoration.widget({
          widget: new AudioLinkButtonWidget(plugin, noteFile, link.rawTarget),
          side: 1
        })
      );
    }
  }

  return builder.finish();
}

class AudioLinkButtonWidget extends WidgetType {
  constructor(
    private readonly plugin: LocalAudioPlusPlugin,
    private readonly noteFile: TFile,
    private readonly rawTarget: string
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof AudioLinkButtonWidget &&
      widget.noteFile.path === this.noteFile.path &&
      widget.rawTarget === this.rawTarget
    );
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clickable-icon local-audio-plus-transcribe-button local-audio-plus-editor-button";
    button.setAttribute("aria-label", t("action.transcribeAudio"));
    setIcon(button, "file-audio");
    setTooltip(button, t("action.transcribeAudio"));
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.plugin.processAudioLink(this.noteFile, this.rawTarget);
    });
    return button;
  }
}

type TranscriptWriteStatus = "inserted" | "replaced" | "skipped" | "missingLink" | "alreadyProcessing";

function createProcessingSummary(): Record<TranscriptWriteStatus, number> {
  return {
    inserted: 0,
    replaced: 0,
    skipped: 0,
    missingLink: 0,
    alreadyProcessing: 0
  };
}

function mergeSettings(data: unknown): LocalAudioPlusSettings {
  const saved = data && typeof data === "object" ? (data as Partial<LocalAudioPlusSettings> & Record<string, unknown>) : {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    provider: normalizeProvider(saved.provider),
    transcriptFormatting: normalizeTranscriptFormatting(saved.transcriptFormatting),
    proxy: {
      ...DEFAULT_SETTINGS.proxy,
      ...(saved.proxy ?? {})
    },
    openai: {
      ...DEFAULT_SETTINGS.openai,
      ...(saved.openai ?? {}),
      uploadFormat: normalizeOpenAIUploadFormat(asRecord(saved.openai).uploadFormat)
    },
    tencent: {
      ...DEFAULT_SETTINGS.tencent,
      ...(saved.tencent ?? {})
    },
    xunfei: {
      ...DEFAULT_SETTINGS.xunfei,
      ...(saved.xunfei ?? {}),
      language: normalizeXunfeiLanguage(asRecord(saved.xunfei).language)
    }
  };
  return settings;
}

function normalizeProvider(value: unknown): LocalAudioPlusSettings["provider"] {
  if (value === "openai" || value === "tencent" || value === "xunfei") return value;
  return DEFAULT_SETTINGS.provider;
}

function normalizeOpenAIUploadFormat(value: unknown): LocalAudioPlusSettings["openai"]["uploadFormat"] {
  if (value === "base64" || value === "formData") return value;
  return DEFAULT_SETTINGS.openai.uploadFormat;
}

function normalizeTranscriptFormatting(value: unknown): LocalAudioPlusSettings["transcriptFormatting"] {
  if (value === "autoParagraphs" || value === "plain") return value;
  return DEFAULT_SETTINGS.transcriptFormatting;
}

function normalizeXunfeiLanguage(value: unknown): LocalAudioPlusSettings["xunfei"]["language"] {
  if (value === "autodialect" || value === "autominor") return value;
  return DEFAULT_SETTINGS.xunfei.language;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
