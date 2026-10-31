# ShanghaiTech GenAI Plugin

`dsh-shanghaitech-genai@1.0.0`，用于 **DSH Desktop 0.2.1-rc.2**。配套本地网关与部署脚本见 [ShanghaiTech-GenAI](https://github.com/Github-Anderson/ShanghaiTech-GenAI)。

## 功能

模型来源、Agent 预设及 provider ID 均为 `shanghaitech-genai`（界面显示 ShanghaiTech GenAI）。支持独立 Search/Thinking 选项、网站附件、来源与 usage，以及 Standard 原生工具和权限流程。PDF 文本工具名为 `shanghaitech_genai_read_pdf`。

## 安装

在配套部署仓库的 `plugin/` 目录取得 tgz，或使用 Node.js 22.19+（22 LTS）/24+ 与 npm 从本仓库打包：

```powershell
git clone git@github.com:Github-Anderson/dsh-shanghaitech-genai.git
cd dsh-shanghaitech-genai
npm pack
```

在 DSH Desktop 插件安装界面选择或提交 `dsh-shanghaitech-genai-1.0.0.tgz` 的完整路径并安装。凭证引用为 `SHANGHAITECH_GENAI_API_KEY`，网关地址由部署启动脚本通过 `SHANGHAITECH_GENAI_BASE_URL` 提供，默认是 `http://127.0.0.1:8000/v1`。

配置凭证后重启 DSH，新建会话，选择 **ShanghaiTech GenAI** 预设与同名模型来源。网关的首次登录和凭证导入步骤见[配套安装指南](https://github.com/Github-Anderson/ShanghaiTech-GenAI/blob/main/安装指南.md)。

已配置 DSH CLI 的环境也可安装到指定 profile：

```sh
dsh plugin --profile <profile-name> add github:Github-Anderson/dsh-shanghaitech-genai#main
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

```sh
npm test
npm pack --dry-run
```

`npm test` 运行八组离线检查，使用合成数据和模拟响应。`test-*-sdk.cjs`、`test-sdk.cjs` 与 `test-command.cjs` 用于已安装 DSH SDK 的集成检查，需通过 DSH 的 Electron-as-Node 运行；相应文件中注明了 SDK 路径参数或 `DSH_TEST_SDK_ROOT` 环境变量。

## 许可证

[MIT License](LICENSE)。保留已有 DeepSeek 版权声明，并记录本项目贡献者的版权。
