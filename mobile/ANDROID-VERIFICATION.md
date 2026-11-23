# Android 迁移与验证

## 959852f 之后的续作

| 阶段 | 完成内容及文件 | 本轮检查 | 剩余工作 |
| --- | --- | --- | --- |
| Android 本地终端 | `Terminal.java`、`WorkspaceModule.kt`、`src/main/cpp`、`TerminalPane.tsx`。切换到 Android NDK PTY，增加行输入、EOF、Ctrl+C、窗口尺寸、停止及受限文件创建。 | NDK 四种 ABI 编译、终端 React Native 组件测试。Android 36.1 模拟器 `tty` 返回 `/dev/pts/1`，`wc` 读取输入和 EOF 后输出 `1 1 6`，Ctrl+C 中断 `cat` 返回 130。 | 开发一套独立可维护的 Node 与包运行环境，验证各厂商 ROM 和实体键盘。 |
| React / TS 运行 | `reactProject.ts`、`useProject.ts`、`build-editor.mjs`、`PreviewServer.java`、`App.tsx`。新增 SAF 模板生成、本机源码编译和带会话的浏览器预览。保留静态构建，并允许打开设备回环开发服务器或远程 HTTPS 预览。 | 模板写入及源码转换测试。真实模板在 Windows 执行 `npm install`、`tsc --noEmit` 与 Vite 构建，生成 `dist/index.html`。启动 Vite 后入口页和 TSX 模块均返回 HTTP 200。 | 完整 Node/npm/npx、HMR、第三方模块解析、远程执行和日志集成。 |
| 编辑器和教学 | `editor-web/editor.ts`、`editor/protocol.ts`、`useProject.ts`、`useTeaching.ts`。加入编辑增量同步、自动换行和语法错误槽。AI 从授权项目枚举有限候选，保留共享定位及用户确认。 | 移动端 5 项测试、共享及桌面 25 项单元测试、两端类型检查、桌面 Vite 构建通过。 | 实体平板触控与蓝牙键鼠、真实 OpenAI 课堂、项目级类型分析、Dart 语义诊断。 |
| 构建与回归 | `build.gradle`、锁文件及 [中文 README](../README.zh-CN.md)。 | 独立 Debug APK 打包、签名校验及 Android 36.1 模拟器安装启动通过。Electron 的 `test:editor` 仍触发基线已知的 Monaco 多行补全显示断言。 | 实体平板和 Termux 流程验收。 |

Android 11+ 的 PTY 与命令许可分开。NDK 提供 `forkpty`；本应用只执行 APK 所在系统环境的 Toybox 白名单，进程仍以应用身份运行，从私有终端目录启动。单次运行有超时，界面支持行输入和控制键。[Android NDK PTY 头文件](https://android.googlesource.com/platform/prebuilts/ndk/+/4448347db136fb3d172c0349c32295c6691df3be/headers/pty.h)

评估了嵌入 libnode 和外部 Termux。nodejs-mobile 的 Android 发布包使用 Node 18，Vite 7 要求 Node 20.19+ 或 22.12+。嵌入新版 libnode 还需要维护 Android ABI、npm 生命周期和原生依赖。Termux 有单独维护的 Node 与 npm 包；应用仅打开用户确认的回环地址，无需 Termux 命令权限。[nodejs-mobile 发布页](https://github.com/nodejs-mobile/nodejs-mobile/releases) [Vite 7 环境要求](https://v7.vite.dev/guide/) [Termux 命令接口](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent)

本机 React 预览用打包的 React 和 ReactDOM、设备端 TypeScript 转换以及以内存快照为源的回环服务。支持模板的相对导入和 HTML 引用的 CSS。Node 安装、远程运行与静态构建的完整操作见 [中文 README](../README.zh-CN.md)。

本轮在 Android 36.1 模拟器从 IDE 通过 SAF 新建模板，核对写入的 TSX、HTML、CSS 和配置文件，再从源码运行。独立 Android WebView 浏览器从应用回环服务渲染了 React 的 `Todo List`。测试文件包含未闭合的 JSX 标签时，应用显示了 `src/App.tsx:1:20` 和具体诊断。经 ADB 转发打开 Windows Vite 服务器后，浏览器成功连接 Vite 并渲染了页面。CodeMirror 增量编辑把标签标为未保存，模拟 Ctrl+S 后核对了 SAF 文件内容。实体平板、真实 Termux 环境和 OpenAI 请求还需分别测试。

## 原始迁移 · 架构扫描和共享教学逻辑

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
5. 在终端运行 `tty`，记录实际 PTY 路径。运行 `wc`，发送 `hello` 一行，再按 EOF，核对一行、一个单词和退出码 0。分别用 Ctrl+C 与停止按钮结束 `sleep 30`。用 `touch test.txt`、`mkdir examples` 和 `ls` 检查终端目录文件，再试 `npm run build` 检查缺少运行环境的提示。
6. 新建 React + TypeScript 项目，打开 `src/App.tsx` 并修改标题。保存后从源码运行模板，在浏览器核对标题。额外加入 JSX 语法错误，保存并重新运行，核对文件和行列号；修正错误后恢复运行。另用 `dist/index.html` 验证静态预览，以及在独立环境启动 Vite 后验证设备开发服务器入口。
7. 启用目标语言的 Android TTS 引擎，分别测试开始、停止、暂停、语速和设置恢复。
