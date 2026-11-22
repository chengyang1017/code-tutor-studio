# Android 迁移与验证

## 第一阶段 · 架构扫描和共享教学逻辑

| 现有位置 | 实现与迁移 |
| --- | --- |
| `package.json`、`src/main.ts` | Vite、TypeScript、DOM 和 Electron。桌面工程没有 React UI。 |
| `src/mentor`、`src/core` | 定位、最小补全、语法安全检查、React Todo 课程、教学数据和 TutorMove 可复用。移入 `shared/teaching` 与 `shared/core`；原入口保留 re-export。原教学测试继续运行。 |
| `src/editor`、`src/character` | 桌面直接依赖 Monaco 模型、装饰、位置和 DOM。移动端重建动画机器人与选区、高亮和诊断桥接。 |
| `src/terminal`、`electron/terminal_ipc.cjs` | 桌面 xterm、Electron IPC、node-pty 和 Windows ConPTY。共享清屏命令识别，移动端用原生进程适配器。 |
| `src/voice`、`electron/windows_tts*` | 浏览器 Web Speech 和 Windows PowerShell 语音。移动端使用 Android TextToSpeech。 |
| `src/project`、`electron` | 文件与项目 IPC，Node.js 路径、进程、系统凭据和 Dart 分析服务。移动端改用 SAF、Android Keystore 和本地 TS/JS 分析。 |
| `src/tablet`、`src/android`、根目录 `android/` | DOM/CSS 布局和 Capacitor 插件。保留现有旧版的文件访问、阅读和 GitHub 功能。 |
| `server/` | 协作阅读 WebSocket 服务。保留这项职责，移动 IDE 不把它当成命令执行服务。 |

## 第二阶段 · 原生工作台、数据与教学

- `mobile/src/App.tsx`、`FileTree.tsx`、`TutorPane.tsx` 实现大屏多面板、窄屏切换、项目文件标签、动画和 TTS 设置。
- `mobile/editor-web/`、`mobile/src/editor/`、`mobile/scripts/build-editor.mjs` 构建和加载离线 CodeMirror。桥接版本由两侧共享的 TypeScript 协议约束，支持文本、选区、保存请求、撤销、重做、教学标记和诊断。CodeMirror 用于移动端文本交互，Monaco 留在桌面。[Monaco 官方移动端说明](https://microsoft.github.io/monaco-editor/)
- `mobile/modules/workspace/`、`mobile/src/model/useProject.ts` 实现 SAF 目录授权、项目恢复、文件操作、编辑缓存、冲突检测和设置。文档提供程序的目录 ID 始终由授权根向下查询。[Android SAF 官方文档](https://developer.android.com/training/data-storage/shared/documents-files)
- `mobile/src/model/useTeaching.ts`、`mobile/src/platform/` 实现课程、OpenAI Responses、确认后发送上下文、跨文件定位、差异确认、应用前重验及教学进度。大文件、定位歧义或磁盘冲突会阻止自动补全。移动端 TypeScript/JavaScript 诊断覆盖语法，项目级类型检查与桌面 Dart Analysis Server 仍由独立环境提供。
- `tests/shared_mobile.test.mjs` 覆盖输入校验、课程、编辑桥接和清屏逻辑。`mobile/src/ui.test.tsx` 覆盖补全确认和工具栏状态。文件权限、触摸输入、按键方式、TTS 引擎和 OpenAI 网络请求需要设备验证。

## 第三阶段 · Android 进程、浏览器预览和构建

- `Terminal.java` 和 `TerminalPane.tsx` 启动 Android 系统 Toybox 并显示真实输出和退出码。AOSP Toybox 使用 0BSD，本应用调用系统已有的二进制。Android 限制从应用可写目录加载可执行程序，完整 PTY、包管理器和可安装的本地运行时留待后续工作。[Toybox 许可](https://android.googlesource.com/platform/external/toybox/+/7aa651a/LICENSE) [Android 执行权限说明](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)
- `PreviewServer.java` 提供限时的回环静态预览，浏览器通过一次入口链接获取会话 Cookie。项目切换或停止预览会关闭监听器。HTTPS 远程预览仅打开用户确认的 URL，命令、源码上传、凭据和执行环境由自管主机独立管理。
- 可选的远程执行扩展应使用独立的端点、按项目授权、最小权限短期凭据、运行与停止接口和有界日志流。移动端每次展示将执行的命令和目标项目并等待确认，远端按项目隔离工作目录，浏览器预览地址与执行权限分开。当前交付只接通 HTTPS 预览地址。
- `mobile/plugins/` 和 `mobile/scripts/build-android.mjs` 生成独立 Android 工程。Gradle Debug 产物嵌入 JavaScript，使用 Android 调试签名。通过 Expo prebuild 生成 `mobile/android`，根目录 Capacitor 工程不参与构建。[Expo 本地构建文档](https://docs.expo.dev/guides/local-app-development/)

## 构建与测试记录

| 范围 | 本次结果 |
| --- | --- |
| 第一阶段 · 桌面与共享逻辑 | 桌面类型检查、24 项 Node 测试和 Vite 构建通过。Electron 界面测试在本次工作区和原始 `HEAD` 上都失败于同一条 Monaco 多行补全显示断言。 |
| 第二阶段 · React Native 组件 | 移动端类型检查和 3 项组件测试通过，覆盖预览确认、保存按钮状态及终端确认和事件展示。 |
| 第三阶段 · Android 构建 | Windows Gradle `:app:assembleDebug` 通过。APK 调试签名校验通过，包内有 JavaScript bundle，包含 ARM 和 x86 的 32 位及 64 位 ABI。 |
| Android 36.1 模拟器 | 无需 Metro 即可安装启动。通过 SAF 授权打开真实 TSX 文件，编辑并用 Ctrl+S 保存到磁盘。横屏同时展示文件树、编辑器、教学和终端。运行 Toybox `pwd` 并收到真实输出和退出码，停止了 `sleep` 进程。外部 Android WebView 测试浏览器渲染了真实 React `dist/` 及其 JavaScript 资源。离线课程检查了测试项目的 `package.json` 并推进下一课，冷启动恢复了项目授权和课程进度。 |

尚无 Android 实体平板、蓝牙键鼠、实体设备语音和真实 OpenAI 请求的验收结果。云盘 SAF 提供程序、编码边界和并发覆盖场景需要按以下步骤单独验收。

## 设备验收步骤

1. 通过 ADB 安装 Debug APK，关闭电脑端 Metro，启动应用。先横屏，打开文件树、源码、教学和终端。
2. 在 Android 系统文件管理器准备一个专用目录。通过应用新建项目或打开目录，创建 `src` 和 `src/App.tsx`，输入、保存、关闭并重开应用。检查文件内容和目录恢复。再验证重命名、取消删除、确认删除。
3. 用另一个编辑器改写同一文件，回到应用保存，核对磁盘版本未被覆盖。再测试混合换行、UTF-16 BOM 和大于 512 KiB 的文件。
4. 用屏幕键盘与外接键鼠选码，测试 Ctrl+S、撤销、重做和横竖屏切换。课程步骤在真实 `src/App.tsx` 上验证。配置自己的 API Key 时，另测 AI 请求、跨文件定位、补全确认、歧义以及变更后重验。
5. 在终端运行 `pwd`、`date` 和 `sleep 30`，检查终端工作目录、退出码、停止和复制。分别尝试 `npm run build` 和不受支持的命令，查看原因。
6. 打开含 `dist/index.html` 的构建产物，确认浏览器加载页面、脚本和样式。回到应用停止预览后刷新，确认服务已关闭。
7. 启用目标语言的 Android TTS 引擎，分别测试开始、停止、暂停、语速和设置恢复。
