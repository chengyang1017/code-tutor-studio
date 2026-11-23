# Code Tutor Studio

[English](README.md) | [简体中文](README.zh-CN.md)

一个独立的开发者学习环境，让动画 AI 导师可以**直接在真实项目代码中进行讲解**。

Code Tutor Studio 并不是传统的“右侧 AI 聊天框”式工具。它会跟随真实代码、跨文件移动，读取 Dart Analysis Server 返回的语义信息，并把项目结构转换成可交互的教学路径。

项目同时包含桌面 IDE、手机 / 平板代码阅读、持久代码便签、语音合成、语义导航和项目级学习工具。

---

## React Native Android IDE

Android 原生 IDE 位于 `mobile/`，使用 Expo SDK 54、React Native、TypeScript 和 Android 原生模块。Android 11 或更新版本可安装，主要面向横屏平板。桌面 Electron 和根目录 `android/` 下的 Capacitor 工程均保留。三个入口及各阶段文件详见 [Android 迁移与验证](mobile/ANDROID-VERIFICATION.md)。

| 能力 | React Native Android |
| --- | --- |
| 项目与编辑 | SAF 选择目录并恢复授权。支持新建项目、文件和目录，删除前确认。多标签、未保存标记、撤销重做、Ctrl+S、可选自动保存，以及检测磁盘冲突后的手动重读。512 KiB 文本上限，支持 UTF-8 和带 BOM 的 UTF-16，混合换行以只读打开，二进制文件保留在目录中。 |
| 平板与手机 | 大屏左侧可折叠和拖宽的文件树、中间代码、右侧教学、底部终端。窄屏切换文件、代码和教学。系统处理横竖屏与软键盘避让。 |
| 语言与教学 | CodeMirror 支持 TS、JS、JSX、TSX、JSON、HTML、CSS、Python、Dart 高亮，可切换自动换行。TS/JS 和 JSON、HTML、CSS、Python 有文件级语法标记。教程可离线验证源码，AI 指导可从实际目录查找候选文件，读取当前文件和选区，支持跨文件定位、暂停、恢复、验证、差异确认、语音和进度保存。 |
| 凭据与权限 | Android Keystore 加密保存 API Key。发送源码前确认 OpenAI 上下文。敏感路径从 AI 上下文排除，敏感文件保存需要确认。文件和终端权限由原生模块持有，编辑器 WebView 只接收编辑消息。 |
| 终端 | Android NDK PTY 承载 Toybox 进程，提供标准输入、合并输出、窗口尺寸、Ctrl+C、EOF、停止及退出码。支持 `tty`、`cat`、`wc`、`sort`、`pwd`、`ls`、`date`、`id`、`uname`、`df`、`sleep 1–30`，以及在私有终端目录创建新文件和目录。SAF 项目文件仍经 Android 文件接口访问。 |
| 运行与预览 | 选择 React + TypeScript 模板可建立可编辑项目。源代码预览将已保存的模板 TS/TSX 编译到内存，用内置 ReactDOM 和设备回环服务在浏览器运行。也可打开设备上的开发服务器、外部 HTTPS 预览或已构建的静态 `dist/`。 |

### React 项目的四种运行方式

1. **从源码运行 React 模板**。选择「新建 → React + TypeScript」，授权父目录，保存源码后选择「运行 → 从源码运行 React 模板」。页面脚本在浏览器运行。编译错误显示文件和行列号，运行时错误显示在页面。适用于模板内的相对导入、TS/JS 模块和 HTML 引用的 CSS，可使用 React、`react-dom/client` 和 React JSX 运行时。保存后重新运行生成新快照。
2. **设备开发服务器**。在单独安装并由用户控制的 Termux 环境手动运行 `pkg install nodejs-lts npm`。按 Termux 提示授予共享存储权限，把项目复制到 Termux 私有工作目录，在那里运行 `npm install`、`npm run dev`，再在 IDE 的「打开设备开发服务器」输入 Vite 输出的 `http://127.0.0.1:5173`。构建日志和进程控制留在 Termux。修改 SAF 源码后需手动同步该副本。[Termux Node 包说明](https://github.com/termux/termux-packages/blob/master/packages/nodejs-lts/build.sh)
3. **外部开发服务器**。在 Windows 或自管主机运行 `npm install`、`npm run dev`；USB 调试时可用 `adb reverse tcp:5173 tcp:5173`，然后在设备开发服务器入口打开回环地址。自管远程主机通过可信 HTTPS 提供预览，使用「打开远程 HTTPS 预览」。运行和构建日志在开发主机。模板使用 Vite 7，请按其 Node 版本要求选环境。[Vite 7 环境要求](https://v7.vite.dev/guide/)
4. **静态网站或构建产物**。可打开静态入口或把开发主机 `npm run build` 产生的 `dist/` 同步进授权目录，再选择「预览静态网站或 dist/」。

应用内 PTY 使用命令白名单和逐次执行确认。内置 Node/npm/npx、任意 shell、全屏终端程序、自动依赖安装、HMR、项目级类型诊断、Dart LSP 和远程进程控制留待后续。React Native 项目使用 Metro 与对应开发构建，Android Gradle 工具链生成独立 APK。

### Windows 生成 APK 并安装到平板

安装 Node.js 22 或 24 LTS、Android Studio 和 JDK 17 或 21。用 Android Studio 的 SDK Manager 安装 Android SDK Platform 36、Build-Tools 36.0.0、Platform-Tools、NDK 27.1.12297006 和 CMake 3.22.1。平板开启开发者选项和 USB 调试，连接后接受设备上的授权提示。

在仓库根目录运行以下 PowerShell 命令。新工程的依赖及锁文件独立于桌面工程。

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools"
cd mobile
npm.cmd ci
npm.cmd run apk:debug
adb devices
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

产物位于 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`，可复制到平板直接安装。手动安装时，按 Android 提示授权所用文件管理器安装应用。此 APK 自带应用 JavaScript，无需在电脑端启动 Metro，采用调试证书签名。包名为 `com.chengyang.codetutor.mobile`，可与旧 Capacitor 版本并存。

如果要调试 React Native 源码，请从 `mobile/` 运行 `npm.cmd run android`。若已安装开发版，可用 `adb reverse tcp:8081 tcp:8081` 和 `npm.cmd start` 启动 Metro，然后从设备启动应用。开发版由本仓库编译，包含 SAF 等原生模块。

### 回归检查

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:editor
npm.cmd ci --prefix mobile
npm.cmd run typecheck --prefix mobile
npm.cmd test --prefix mobile
```

以下桌面功能说明也适用于原有 Capacitor 路径中已实现的部分。React Native 能力以本节为准。

---
## 截图

> 这里暂时保留截图占位。准备好图片后，将文件放到 `docs/screenshots/` 即可。

### 桌面 IDE

📸 **截图占位：** `docs/screenshots/desktop-ide.png`

### 编辑器中的 AI 导师

📸 **截图占位：** `docs/screenshots/ai-tutor.png`

### Dart 语义导航

📸 **截图占位：** `docs/screenshots/dart-navigation.png`

### 持久代码便签

📸 **截图占位：** `docs/screenshots/code-notes.png`

### 平板 / 手机代码阅读器

📸 **截图占位：** `docs/screenshots/tablet-reader.png`

### 外观 / 背景自定义

📸 **截图占位：** `docs/screenshots/appearance.png`

### 共享阅读会话

📸 **截图占位：** `docs/screenshots/shared-reader.png`

---

## 为什么做这个项目

大多数 AI 编程工具会把 AI 放在代码旁边。

Code Tutor Studio 尝试另一种交互方式：

```text
真实项目
   ↓
语义代码结构
   ↓
教学路径
   ↓
Tutor 跳到相关文件 / 代码行
   ↓
高亮 + 解释 + 朗读
```

目标是让代码讲解更像有人带着你沿着真实项目一步一步看，而不是让 AI 在另一个聊天窗口里单独回答问题。

---

## 核心功能

### 项目级代码编辑器

- 打开真实项目并浏览文件树
- 基于 Monaco Editor 的代码编辑
- 真正修改原始文件
- `Ctrl+S` 写回磁盘
- 未保存状态提示
- 自动恢复上次打开的项目和文件
- 面向桌面 IDE 的工作台布局

### 直接位于代码区的 AI Tutor

动画 Tutor 不固定住在单独的 AI 面板中，而是直接出现在代码区域附近。

它可以：

- 在教学目标之间移动
- 按 `TutorMove[]` 教学路径跨文件跳转
- 高亮相关代码
- 显示紧凑讲解文字
- 朗读当前讲解
- 尽量避开代码字符，不挡住正在解释的内容

### Dart 语义导航

项目接入 **Dart Analysis Server**，获得真实项目级语义信息。

当前主要能力包括：

- Definition 跳转
- References
- Document Symbols
- Call Hierarchy
- Function / Method / Constructor 定位
- `Ctrl+Click` 语义跳转

一个典型教学流程可以理解为：

```text
选中 Dart 函数
      ↓
Dart Analysis Server
      ↓
真实语义节点
      ↓
AI 组织教学顺序
      ↓
Tutor 跨文件移动
```

AI 不应该随意猜测代码位置，而是先让 LSP / Analysis Server 提供真实节点，再让 AI 决定如何组织讲解。

### 持久代码便签

Code Tutor Studio 可以把学习笔记绑定到代码位置，同时**不修改源码本身**。

便签可以显示在：

- 代码旁
- 行号 / gutter 附近

项目级便签可保存在：

```text
.ai-code-tutor/
├── notes.json
└── assets/
```

这样便签可以和项目一起提交 Git，让其他人打开同一个项目时看到相同的学习记录。

便签系统还支持：

- 持久文本便签
- 图片附件
- 粘贴截图
- 拖放图片
- 使用 `anchorText` 在代码发生轻微位移后重新定位
- 从旧版本地便签存储自动迁移

### Tutor 语音

在 Windows 上，应用可以通过 Electron 调用原生语音合成。

```text
TutorMove.speech
      ↓
Voice Controller
      ↓ IPC
Electron Main
      ↓
Windows.Media.SpeechSynthesis
      ↓
音频播放
      ↓
Tutor 说话动画
```

可以保存的语音偏好包括：

- 是否启用语音
- 语言
- 具体 Voice
- 语速

### API Key 安全保存

桌面端可以通过 Electron `safeStorage` 保存 OpenAI API Key。

在 Windows 中，底层依赖当前用户的 DPAPI 保护，而不是把 Key 直接明文写进文件。

```text
API Key
   ↓
Electron safeStorage
   ↓
Windows DPAPI
   ↓
加密后的本地状态
```

### 平板 / 手机阅读模式

仓库中还包含 Android / Capacitor 和平板专用代码路径，用来探索小屏幕上的代码学习体验。

这里的目标不是把桌面 IDE 直接缩小，而是针对小屏幕重新设计代码阅读与导航方式。

当前探索包括：

- 平板专用布局
- 手机 Reader Session
- 响应式代码显示
- 阅读优先控制方式

### 共享 Reader Session

项目包含轻量的 reader-room server 和 WebSocket 支持，用于多人 / 多设备共享阅读会话。

这让项目不再只是单机代码编辑器，也为后续协作学习提供基础。

---

## 架构

高层结构可以理解为：

```text
┌──────────────────────────────┐
│ Vite + TypeScript Renderer   │
│ Monaco Editor                │
└──────────────┬───────────────┘
               │
               │ IPC
               ▼
┌──────────────────────────────┐
│ Electron Main Process        │
│ 文件系统 / safeStorage      │
│ Windows 原生 TTS             │
└──────────────┬───────────────┘
               │
               ├───────────────► Dart Analysis Server
               │
               └───────────────► 本地项目文件

可选 Reader / 分享路径：

Android / Capacitor
        │
        ▼
Reader workflow
        │
        ▼
WebSocket reader-room server
```

---

## 项目结构

当前仓库已经把桌面端、编辑器、Reader、平板、便签、项目状态和 Tutor Character 拆成独立区域。

```text
code-tutor-studio/
├── android/
├── electron/
├── server/
├── src/
│   ├── android/
│   ├── character/
│   ├── core/
│   ├── demo/
│   ├── desktop/
│   ├── editor/
│   ├── memorize/
│   ├── notes/
│   ├── project/
│   ├── reader/
│   └── tablet/
├── capacitor.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 技术栈

### 桌面端

- Electron
- TypeScript
- Vite
- Monaco Editor

### 代码智能 / 语义分析

- Dart Analysis Server
- Definition / References / Call Hierarchy
- 项目级语义导航

### 手机 / 平板

- Capacitor
- Android
- 响应式 Reader UI

### 通信 / 数据

- WebSocket (`ws`)
- PostgreSQL Client (`pg`)

### 桌面系统集成

- Electron IPC
- 文件系统访问
- `safeStorage`
- Windows 原生语音合成

---

## 开发

安装依赖：

```bash
npm install
```

TypeScript 类型检查：

```bash
npm run typecheck
```

运行桌面开发环境：

```bash
npm run dev
```

构建 Renderer：

```bash
npm run build
```

打包 Windows 安装程序：

```bash
npm run package:win
```

启动 Reader Room Server：

```bash
npm run reader:server
```

Dart 语义功能要求本机可以使用 Dart SDK：

```bash
dart --version
```

---

## 当前能力

```text
真实项目文件树
+ Monaco 代码编辑器
+ Ctrl+S 真正写回文件
+ Dart Definition / References / Call Hierarchy
+ Ctrl+Click 语义跳转
+ AI 组织真实语义教学路线
+ Tutor 跨文件移动
+ Windows 原生 TTS
+ 项目级持久代码便签
+ 便签图片附件
+ 项目 / 文件会话恢复
+ 平板 / Android Reader 实验
+ Shared Reader Session 基础
```

---

## 当前限制

- 完整语义能力目前仍以 Dart / Flutter 项目最强。
- 当前定位仍然是实验型开发者学习环境，不是完整替代 VS Code 或 Android Studio。
- 完整 Debugger、集成终端、Git UI、外部文件冲突处理等高级 IDE 功能仍未完全实现。
- Windows 原生语音取决于系统实际暴露给应用的 Voice。
- 手机和平板工作流仍然在独立演进，不会简单复制桌面 IDE。

---

## 设计方向

Code Tutor Studio 的核心想法只有一句：

> **代码学习应该尽可能发生在真正被解释的代码附近。**

项目希望把：

```text
Code
+
Semantic Structure
+
AI Explanation
+
Navigation
+
Voice
+
Persistent Notes
```

组合成一个统一的开发者学习环境。

---

## 状态

**持续开发中。**

当前已经包含 Electron 桌面 IDE、Monaco 编辑器、Dart 语义导航、动画 Tutor 教学路线、持久代码便签、Windows 原生语音、Android / 平板 Reader，以及共享阅读会话基础设施。
