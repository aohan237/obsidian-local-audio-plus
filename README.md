# Local Audio Plus

Obsidian desktop plugin for scanning local audio links in notes and inserting transcripts.

Supported providers:

- OpenAI Audio Transcriptions
- Tencent Cloud recording file recognition (`CreateRecTask` with local base64 audio upload)
- iFlytek recording file transcription (`/v2/upload` + `/v2/getResult`)

OpenAI normal transcription can use `gpt-4o-mini-transcribe` for lower cost or `gpt-4o-transcribe` for higher accuracy. Speaker diarization uses `gpt-4o-transcribe-diarize`.

Tencent Cloud local upload uses `SourceType=1`, so the original audio file must be no larger than 5 MB.

iFlytek uses APPID, APIKey, and APISecret from the "录音文件转写大模型" console. In the API documentation, APIKey is also called `accessKeyId`, and APISecret is also called `accessKeySecret`. APISecret is signed as the original UTF-8 string; do not Base64 decode it. The default language mode is `autodialect`; `autominor` requires manual enablement from iFlytek.

The shared speaker diarization setting is used by supported providers. For iFlytek, enabling it sends `roleType=1` for general role separation, and the optional speaker count is sent as `roleNum` when it is between 1 and 10.

## Privacy and network disclosure

Local Audio Plus reads local audio files referenced by notes in your vault and sends the selected audio content to the transcription provider you configure.

Network requests may be sent to:

- OpenAI API, using the configured OpenAI base URL.
- Tencent Cloud ASR.
- iFlytek recording file transcription.
- A user-configured HTTP, HTTPS, SOCKS5, or SOCKS5H proxy, if enabled.

API credentials are stored in this plugin's Obsidian plugin data inside your vault. This plugin does not include telemetry, ads, or analytics.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## 发布到 Obsidian 插件市场

发布前确认：

- `manifest.json`、`package.json` 和 `package-lock.json` 里的版本一致。
- GitHub release 的 tag 和 `manifest.json` 里的 `version` 完全一致，例如 `1.0.3`。
- 仓库根目录包含 `README.md`、`LICENSE`、`manifest.json` 和源码。

生成发布文件：

```bash
npm run release
```

这个命令会先执行生产构建，然后生成 Obsidian 插件市场需要上传到 GitHub Release 的独立文件：

```text
dist/main.js
dist/manifest.json
dist/styles.css
```

同时也会生成离线安装 zip：

```text
dist/local-audio-plus-<version>.zip
```

在 GitHub 创建 release 时，上传 `dist/main.js`、`dist/manifest.json` 和 `dist/styles.css`。然后到 <https://community.obsidian.md> 登录 Obsidian 账号，连接 GitHub 账号，在 Plugins 里提交这个仓库。

## 发布离线安装包

生成离线发布 zip：

```bash
npm run release
```

这个命令会先执行生产构建，然后生成：

```text
dist/local-audio-plus-<version>.zip
```

`<version>` 来自 `manifest.json` 里的版本号，例如 `1.0.3` 会生成：

```text
dist/local-audio-plus-1.0.3.zip
```

发布 GitHub release 时请创建与 `manifest.json` 版本完全一致的 tag：

```bash
git tag 1.0.3
```

zip 内结构如下：

```text
local-audio-plus/
  main.js
  manifest.json
  styles.css
  README.md
  install.ps1
  install.sh
```

其中：

- `install.ps1`：Windows PowerShell 自动安装脚本
- `install.sh`：Linux 自动安装脚本
- `README.md`：给离线安装用户看的说明

安装脚本会读取 Obsidian 本地配置，优先选择当前打开的 vault；如果没有当前打开的 vault，会选择最近打开的 vault。脚本会复制插件文件到：

```text
<vault>/.obsidian/plugins/local-audio-plus/
```

并把插件 ID 写入：

```text
<vault>/.obsidian/community-plugins.json
```

Windows 用户解压 zip 后，在 `local-audio-plus` 文件夹里运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

Linux 用户解压 zip 后，在 `local-audio-plus` 文件夹里运行：

```bash
chmod +x ./install.sh
./install.sh
```
