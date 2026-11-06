# ShanghaiTech GenAI Plugin

`dsh-shanghaitech-genai@1.0.7`，用于 **DSH Desktop ≥ 0.2.1-rc.2**。配套本地网关与部署脚本见 [ShanghaiTech-GenAI](https://github.com/Github-Anderson/ShanghaiTech-GenAI)。

## 功能

模型来源、Agent 预设及 provider ID 均为 `shanghaitech-genai`（界面显示 ShanghaiTech GenAI）。支持独立 Search/Thinking 选项、网站附件、来源与 usage，以及 Standard 原生工具和权限流程。PDF 文本工具名为 `shanghaitech_genai_read_pdf`。

按钮随 DSH 语言显示为“联网搜索 / 深度思考 / 网页附件”或“Search / Thinking / Attachments”。可用模型和能力来自网关读取的网站配置，当前全部聊天模型都有 Search，除 Qwen 外均有 Thinking。新建、切换模型或恢复会话时关闭 Thinking，Search 保留当前选择。网站搜索进度、来源、用量和响应标识随同一次请求接收。

网页附件接受 PNG、JPEG、WebP、GIF 图片，以及 PDF、TXT、CSV、DOCX、XLS、XLSX、PPT、PPTX、HTML、HTM、MD、MARKDOWN、LOG、JSON 文档，单文件均严格小于 10 MiB。网关按网站参数压缩大图，GIF 保留原文件；文档需由网站提取文字，扫描件不提供 OCR 回退。独立 PDF 文本工具仍只处理 PDF。

## 批量子代理

选择 ShanghaiTech GenAI 预设后，大批量独立委派使用 DSH 原生 `workflow`；原生工作流每次创建并运行一个子代理，其余任务在创建前等待。后台工作流使用 `job_output` 查看进度、`job_kill` 取消。少量委派继续使用 `subagent` / `subagent_fork`。

工作流沿用 DSH 的总量限制和进程生命周期，不能跨重启自动恢复。其他预设的工作流配置保持不变。网关请求入队失败时，插件交给 DSH 原生重试机制最多退避重试 8 次；流中断、空响应和工具格式错误不在客户端自动重放。

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
github:Github-Anderson/dsh-shanghaitech-genai#v1.0.7
```

在 **插件 → ShanghaiTech GenAI → 网关连接** 中设置网关密钥及可选的远程主机地址，点击“保存”。地址留空连接 `127.0.0.1:8000`；支持主机名、IP、`主机:端口` 和完整 HTTP(S) URL，仅填主机时默认使用 8000 端口。

密钥框载入请求实际使用的密钥，默认隐藏，点击“显示密钥 / 隐藏密钥”切换；重新打开、重新载入或保存后恢复隐藏。修改未保存时会显示提示，密钥框留空保存会保留原值。

地址和密钥由 DSH 原生凭证库统一保存，后续新请求立即使用保存的值；正在进行的附件上传及聊天共用原连接。首次未保存时使用 DSH 凭证引用 `SHANGHAITECH_GENAI_API_KEY` 和默认本地地址。插件不再读取部署私有 JSON、`gateway.key`、旧详情页配置文件或地址环境变量。通过配套安装脚本升级时，首次自动将私有配置中的地址与密钥一起迁入原生凭证库；普通更新和启动保留已保存的连接，明确传入网关连接参数才替换。直接安装插件时可在详情页设置连接；旧文件保留。开发与日常 DSH 使用各自的凭证库。

配置凭证后新建会话，选择 **ShanghaiTech GenAI** 预设与同名模型来源。网关的首次登录和凭证导入步骤见[配套安装指南](https://github.com/Github-Anderson/ShanghaiTech-GenAI/blob/main/安装指南.md)。

已配置 DSH CLI 的环境也可安装到指定 profile：

```sh
dsh plugin --profile <profile-name> add github:Github-Anderson/dsh-shanghaitech-genai#v1.0.7
```

仓库中的运行入口为可直接加载的 JavaScript，无需编译；私有仓库的 GitHub 安装需要当前 Git 环境有读取权限。`private: true` 用于避免误发布到 npm。

## 插件结构

本包按 [DeepSeek Harness 官方插件打包规范](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)组织为 Bundle：

- `package.json` 声明 `dsh.bundle.patch`、`dsh.client`、导出入口、发布文件和兼容版本。
- `cordis.patch.yml` 挂载模型与会话选项插件，以及 Agent 预设插件。
- `index.cjs` 导出 Cordis 插件的 `name`、`inject` 和 `apply`。
- `client.js` 提供 DSH 客户端界面，`locale/` 提供中英文文本。
- `agent-preset.cjs` 和 `pdf-reader.cjs` 提供 Agent 预设与 PDF 工具。

## macOS 隔离联调

在工作区运行配套网关仓库的 `tools/Dev.sh --local-root "$PWD/local" --plugin-repo /path/to/dsh-shanghaitech-genai`，再通过 `local/deploy/Start.sh` 打开测试 DSH。开发插件安装到 `local/dsh/`，连接 `http://127.0.0.1:8000/v1`；后续使用 `local/Update.sh` 更新并重新启动测试实例。

日常客户端通过配套 `tools/Install-Client.sh` 安装已发布标签，并保留独立的远程网关地址。两类环境的配置和启动入口见配套仓库 `tools/README.md`。

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

macOS 运行离线检查时设置 `TMPDIR=/private/tmp`，避免系统临时目录符号链接触发路径防护；Node 需满足 `package.json` 的版本要求，也可使用 DSH 应用内置 Node/pnpm。`npm test` 在隔离的 DSH 数据目录中运行离线回归检查，使用合成数据和模拟响应。`test-*-sdk.cjs`、`test-sdk.cjs` 与 `test-command.cjs` 用于已安装 DSH SDK 的集成检查，需通过 DSH 的 Electron-as-Node 运行；相应文件中注明了 SDK 路径参数或 `DSH_TEST_SDK_ROOT` 环境变量。

当前源码声明支持 DSH ≥ 0.2.1-rc.2，不设版本上限；不再将 SDK 检查锁定到某个 rc 版本，各 SDK 包仍需版本一致。Git 标签安装仍使用已发布版本；本地验证当前未发布修改时，按配套仓库 `tools/README.md` 先同步再部署。

`test-live-sdk.cjs` 是手动启用的本机联调：设置 `GENAI_LIVE_TEST=1`、开发 `DSH_HOME`、`DSH_TEST_SDK_ROOT` 和指向开发 profile 已安装插件的 `DSH_TEST_PLUGIN_ROOT`，通过 Electron-as-Node 执行。默认测试 Qwen，可用 `GENAI_TEST_MODEL` 指定其他非 GPT 模型；验证真实流式及工具往返，工具结果为模拟值，结束后删除测试网站会话。

## 许可证

[MIT License](LICENSE)。保留已有 DeepSeek 版权声明，并记录本项目贡献者的版权。
