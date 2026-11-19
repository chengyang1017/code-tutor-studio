export type Lesson = {
  id: string;
  title: string;
  file: string;
  objective: string;
  explanation: string;
  instruction: string;
  hint: string;
  checks: Array<{ label: string; test: (source: string) => boolean }>;
};

export const reactTodoLessons: Lesson[] = [
  {
    id: 'setup', title: '创建 React + TypeScript 项目', file: 'package.json',
    objective: '建立真正的 Vite + React + TypeScript 项目。',
    explanation: '打开终端进入你想保存项目的上级目录，输入下面的命令。Vite 是开发工具，React 用于构建组件，TypeScript 为 JavaScript 提供类型检查。创建完成后使用顶部「打开项目」选择新建的 todo-lesson 文件夹。',
    instruction: 'npm create vite@latest todo-lesson -- --template react-ts\ncd todo-lesson\nnpm install',
    hint: '先确认 Node.js 和 npm 已安装。命令由你在终端执行；本课程不会自动运行或覆盖任何文件。',
    checks: [
      { label: 'React 依赖', test: (s) => /"react"\s*:/.test(s) },
      { label: 'Vite 开发工具', test: (s) => /"vite"\s*:/.test(s) },
      { label: 'TypeScript 依赖', test: (s) => /"typescript"\s*:/.test(s) },
    ],
  },
  {
    id: 'component', title: '认识 App 组件', file: 'src/App.tsx',
    objective: '理解 JSX、组件函数与 return。',
    explanation: 'React 的组件是返回 JSX 的函数。JSX 看起来像 HTML，但写在 TypeScript 中，最终由 React 渲染。这里我们先写一个清晰的标题。',
    instruction: '在 App.tsx 中写一个返回 <h1>Todo List</h1> 的 App 组件，并 export default App。',
    hint: '尝试 function App() { return <h1>Todo List</h1> }。记得导出组件。',
    checks: [
      { label: '声明 App 组件', test: (s) => /(?:function\s+App|(?:const|let)\s+App\s*=)/.test(s) },
      { label: '包含 Todo List 标题', test: (s) => /<h1[^>]*>\s*Todo List\s*<\/h1>/.test(s) },
      { label: '导出 App', test: (s) => /export\s+default\s+App/.test(s) },
    ],
  },
  {
    id: 'state', title: '使用 useState 管理任务', file: 'src/App.tsx',
    objective: '学会状态和 TypeScript 字符串数组。',
    explanation: 'useState 保存组件状态。每次通过 setter 更新状态时，React 会重新渲染。不要直接修改状态数组。',
    instruction: '从 react 导入 useState，在 App 内创建 tasks 状态：const [tasks, setTasks] = useState<string[]>([])。',
    hint: 'import { useState } from "react"; 注意泛型 <string[]> 与 [] 初始值。',
    checks: [
      { label: '导入 useState', test: (s) => /import\s*{[^}]*\buseState\b[^}]*}\s*from\s*['"]react['"]/.test(s) },
      { label: '声明 tasks 状态', test: (s) => /\[\s*tasks\s*,\s*setTasks\s*\]\s*=\s*useState\s*<\s*string\s*\[\s*\]\s*>\s*\(\s*\[\s*\]\s*\)/.test(s) },
    ],
  },
  {
    id: 'input', title: '输入框与受控组件', file: 'src/App.tsx',
    objective: '用 state 管理输入框内容。',
    explanation: '受控输入框的 value 来自 state，onChange 更新 state。这样页面输入与数据始终保持同步。',
    instruction: '创建 input 状态和 setInput，并在 JSX 添加 <input value={input} onChange={...} />。',
    hint: 'const [input, setInput] = useState(""); onChange={(event) => setInput(event.target.value)}',
    checks: [
      { label: '包含输入状态', test: (s) => /\[\s*input\s*,\s*setInput\s*\]/.test(s) },
      { label: '受控 input', test: (s) => /<input\b[^>]*value\s*=\s*{\s*input\s*}/s.test(s) },
      { label: '监听 onChange', test: (s) => /onChange\s*=/.test(s) && /setInput\s*\(/.test(s) },
    ],
  },
  {
    id: 'add', title: '添加 Todo 任务', file: 'src/App.tsx',
    objective: '编写事件处理函数并更新数组。',
    explanation: '事件处理函数负责把输入内容加入任务数组。推荐使用函数式更新 setTasks(prev => [...prev, newTask])，避免直接修改原数组。',
    instruction: '新增「添加」按钮，绑定 onClick。点击时使用 setTasks 添加非空输入，并清空输入框。',
    hint: '可以创建 addTask 函数：if (!input.trim()) return; setTasks(prev => [...prev, input.trim()]); setInput("");',
    checks: [
      { label: '按钮 click 事件', test: (s) => /<button\b[^>]*onClick\s*=/s.test(s) },
      { label: '更新 tasks', test: (s) => /setTasks\s*\(/.test(s) },
      { label: '清空输入', test: (s) => /setInput\s*\(\s*['"]\s*['"]\s*\)/.test(s) },
    ],
  },
  {
    id: 'list', title: '渲染任务列表', file: 'src/App.tsx',
    objective: '学习数组 map 与 React key。',
    explanation: 'map 把任务数组变成一组 JSX 元素；每个列表节点需要稳定的 key。练习版可用索引，但可编辑、删除和重排时应改用独立 id。',
    instruction: '使用 tasks.map 渲染 li，并为每项提供 key。',
    hint: '{tasks.map((task, index) => <li key={index}>{task}</li>)}',
    checks: [
      { label: '使用 tasks.map', test: (s) => /tasks\.map\s*\(/.test(s) },
      { label: '列表节点', test: (s) => /<li\b/.test(s) },
      { label: '提供 key', test: (s) => /\bkey\s*=/.test(s) },
    ],
  },
  {
    id: 'remove', title: '删除任务', file: 'src/App.tsx',
    objective: '学习 filter 与不可变更新。',
    explanation: 'filter 返回一个新的数组，可以排除用户点击的任务。这样 React 才能可靠地感知状态更新。',
    instruction: '给每条任务加删除按钮，调用 setTasks 并用 filter 移除对应任务。',
    hint: 'setTasks(prev => prev.filter((_, i) => i !== index))',
    checks: [
      { label: '使用 filter', test: (s) => /\.filter\s*\(/.test(s) },
      { label: '删除时更新 tasks', test: (s) => /setTasks\s*\(/.test(s) },
      { label: '存在删除按钮', test: (s) => /<button\b[\s\S]*?(?:删除|Delete|Remove)/i.test(s) },
    ],
  },
  {
    id: 'style', title: '拆分 CSS 并完成页面', file: 'src/App.css',
    objective: '通过独立样式文件美化 Todo 页面。',
    explanation: '把视觉样式放在 CSS 文件，JSX 负责结构与逻辑。这样组件更易阅读、维护。',
    instruction: '在 App.css 中编写 button、input、li 的样式，并确认 App.tsx 中导入 "./App.css"。',
    hint: '例如 button { cursor: pointer; } input { padding: 8px; } li { margin: 8px 0; }',
    checks: [
      { label: '按钮样式', test: (s) => /button\s*[{,.:#\[]/.test(s) },
      { label: '输入框样式', test: (s) => /input\s*[{,.:#\[]/.test(s) },
      { label: '列表样式', test: (s) => /li\s*[{,.:#\[]/.test(s) },
    ],
  },
];
