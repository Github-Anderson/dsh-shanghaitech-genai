# ShanghaiTech GenAI Plugin

`dsh-shanghaitech-genai@1.0.5`，用于 **DSH Desktop ≥ 0.2.1-rc.2**。配套本地网关与部署脚本见 [ShanghaiTech-GenAI](https://github.com/Github-Anderson/ShanghaiTech-GenAI)。

## 功能

模型来源、Agent 预设及 provider ID 均为 `shanghaitech-genai`（界面显示 ShanghaiTech GenAI）。支持独立 Search/Thinking 选项、网站附件、来源与 usage，以及 Standard 原生工具和权限流程。PDF 文本工具名为 `shanghaitech_genai_read_pdf`。

按钮随 DSH 语言显示为“联网搜索 / 深度思考 / 网页附件”或“Search / Thinking / Attachments”。搜索和思考以高亮表示启用状态，直接调用原网页对应功能；思考选项按网关能力显示，配套配置对 Kimi 和 GPT 系列开放。网页附件在发送时将原文件交给网站图片上传或文档解析接口。

网页附件接受 PNG、JPEG、WebP、GIF 图片（严格小于 20 MiB），以及 PDF、TXT、CSV、DOCX、XLS、XLSX、PPT、PPTX、HTML、JSON 文档（严格小于 10 MiB）。2026-11-01 通过 DeepSeek 网站接口验证新增的六种文档均能提取合成标记；DOC、XML 被网站拒绝，保持关闭。需配套更新网关，并由所选模型开放附件能力；扫描件无文本时不提供 OCR 回退。独立 PDF 文本工具仍只处理 PDF。

## 删除会话

输入区的“删除会话 / Delete session”会显示独立确认，默认勾选“同时删除网站历史 / Also delete website history”。确认后永久删除当前本地会话及其子代理，并清理工作区记录；不删除工作区文件或独立分叉。

同步网站历史时，网站确认成功后才删除本地会话。旧会话缺少上游映射或登录令牌已变更时，请到网站清理历史，或明确取消勾选，仅删除本地会话。生成中或有待处理工作的会话须先停止。

兼容 DSH 默认关闭的全文搜索；已完成删除后的搜索索引刷新异常只显示警告，不再误报为整体失败。功能适配已检查的 JSONL 存储生命周期，不支持的后端会拒绝删除。更新后请完全退出 DSH，包括 Windows 托盘后台或 macOS 后台进程，再重新打开。

## 安装

Windows 和 macOS 本地开发环境均可使用配套仓库的同步与部署脚本，从当前源码打包并安装插件。在两个同级仓库的父目录运行。

Windows（PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File .\ShanghaiTech-GenAI\tools\Sync-Local.ps1
powershell -ExecutionPolicy Bypass -File .\ShanghaiTech-GenAI\tools\Deploy-Local.ps1
```

macOS（终端）：

```sh
./ShanghaiTech-GenAI/tools/Sync-Local.sh
./ShanghaiTech-GenAI/tools/Deploy-Local.sh
```

在网关仓库运行 `tools/Setup.sh`（macOS）或 `tools/Setup.ps1` / `tools/Setup.cmd`（Windows）完成首次部署和后续更新。运行目录默认为 macOS 的 `~/.local/share/shanghaitech-genai/`，或 Windows 的 `%LOCALAPPDATA%\ShanghaiTech-GenAI\`。配置和网站凭证保存在其中的 `deploy/private/`；检查完成后完全退出 DSH，再通过运行目录中的 `deploy/Start.sh` 或 `deploy/Start.ps1` 启动。详细参数见配套仓库的[本地开发环境](https://github.com/Github-Anderson/ShanghaiTech-GenAI/blob/main/tools/README.md)。

如果选择安装已发布版本，可在 DSH Desktop 插件安装界面提交以下来源：

```text
github:Github-Anderson/dsh-shanghaitech-genai#v1.0.5
```

本地部署会自动登记私有目录，插件从其中的 `dsh-gateway.json` 读取 `base_url` 和 `key_file`，直接打开 DSH Desktop 也会使用该配置。`base_url` 未填写或留空时，使用 `http://127.0.0.1:8000/v1` 及私有目录中的 `gateway.key`；配置远程地址时，使用 `key_file` 指定的密钥文件（相对于私有目录）。配置示例和部署步骤见配套仓库的[本地开发环境](https://github.com/Github-Anderson/ShanghaiTech-GenAI/blob/main/tools/README.md)。尚未登记私有目录时，地址可通过 `SHANGHAITECH_GENAI_BASE_URL` 提供，密钥使用 DSH 凭证引用 `SHANGHAITECH_GENAI_API_KEY`。已发布的 v1.0.5 可通过 Git 标签安装；本地源码部署使用同步脚本生成的插件包，包含未提交修改。

配置凭证后重启 DSH，新建会话，选择 **ShanghaiTech GenAI** 预设与同名模型来源。网关的首次登录和凭证导入步骤见[配套安装指南](https://github.com/Github-Anderson/ShanghaiTech-GenAI/blob/main/安装指南.md)。

已配置 DSH CLI 的环境也可安装到指定 profile：

```sh
dsh plugin --profile <profile-name> add github:Github-Anderson/dsh-shanghaitech-genai#v1.0.5
```

仓库中的运行入口为可直接加载的 JavaScript，无需编译；私有仓库的 GitHub 安装需要当前 Git 环境有读取权限。`private: true` 用于避免误发布到 npm。

## 插件结构

本包按 [DeepSeek Harness 官方插件打包规范](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)组织为 Bundle：

- `package.json` 声明 `dsh.bundle.patch`、`dsh.client`、导出入口、发布文件和兼容版本。
- `cordis.patch.yml` 挂载模型与会话选项插件，以及 Agent 预设插件。
- `index.cjs` 导出 Cordis 插件的 `name`、`inject` 和 `apply`。
- `client.js` 提供 DSH 客户端界面，`locale/` 提供中英文文本。
- `agent-preset.cjs` 和 `pdf-reader.cjs` 提供 Agent 预设与 PDF 工具。

## 开发检查

Windows（PowerShell）：

```powershell
npm test
npm pack --dry-run
```

macOS（终端）：

```sh
TMPDIR=/private/tmp npm test
npm pack --dry-run
```

macOS 运行离线检查时设置 `TMPDIR=/private/tmp`，避免系统临时目录符号链接触发路径防护；Node 需满足 `package.json` 的版本要求，也可使用 DSH 应用内置 Node/pnpm。`npm test` 在隔离的 DSH 数据目录中运行十组离线检查，使用合成数据和模拟响应。`test-*-sdk.cjs`、`test-sdk.cjs` 与 `test-command.cjs` 用于已安装 DSH SDK 的集成检查，需通过 DSH 的 Electron-as-Node 运行；相应文件中注明了 SDK 路径参数或 `DSH_TEST_SDK_ROOT` 环境变量。

当前源码声明支持 DSH ≥ 0.2.1-rc.2，不设版本上限；不再将 SDK 检查锁定到某个 rc 版本，各 SDK 包仍需版本一致。Git 标签安装仍使用已发布版本；本地验证当前未发布修改时，按配套仓库 `tools/README.md` 先同步再部署。

## 许可证

[MIT License](LICENSE)。保留已有 DeepSeek 版权声明，并记录本项目贡献者的版权。
