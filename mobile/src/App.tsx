import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, StatusBar, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Editor } from './editor/Editor';
import { reactRuntime } from './editor/generated';
import { buildReactSnapshot } from './platform/reactProject';
import { useProject } from './model/useProject';
import { useTeaching } from './model/useTeaching';
import { confirm, errorMessage } from './model/feedback';
import { credentials, voice } from './platform/services';
import { semantics } from './platform/semantics';
import { workspace } from './platform/workspace';
import type { Entry } from './platform/workspace';
import { FileTree } from './FileTree';
import type { FileAction } from './FileTree';
import { TerminalPane } from './TerminalPane';
import { TutorPane } from './TutorPane';
import { Button, colors, styles } from './ui';

type Dialog = FileAction | { kind: 'project' | 'settings' | 'run' };

export default function App() {
  return <SafeAreaProvider><Studio /></SafeAreaProvider>;
}

function Studio() {
  const { width, height } = useWindowDimensions();
  const wide = width >= 760 && width > height;
  const [screen, setScreen] = useState<'files' | 'editor' | 'tutor'>('editor');
  const [showFiles, setShowFiles] = useState(true);
  const [showTutor, setShowTutor] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [treeWidth, setTreeWidth] = useState(230);
  const [selected, select] = useState<Entry>();
  const [dialog, setDialog] = useState<Dialog>();
  const [name, setName] = useState('');
  const [message, report] = useState('');
  const [autoSave, setAutoSave] = useState(false);
  const [voiceEnabled, enableVoice] = useState(true);
  const [language, setLanguage] = useState('zh-CN');
  const [rate, setRate] = useState(1);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [remote, setRemote] = useState('');
  const [deviceServer, setDeviceServer] = useState('http://127.0.0.1:5173');
  const [starter, setStarter] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [buildingPreview, setBuildingPreview] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const tutor = useTeaching(report);
  const model = useProject(report, tutor.load, autoSave);
  const active = model.tabs.find(item => item.path === model.active);
  const drag = useRef({ x: 0, width: treeWidth });
  const lastRevealed = useRef('');
  const voiceGeneration = useRef(0);
  const visibleEditor = wide || screen === 'editor';

  useEffect(() => {
    if (model.ready && active) model.editor.current?.send({ type: 'wrap', id: active.id, enabled: wrapLines });
  }, [model.ready, active?.id, wrapLines]);

  function run(task: () => unknown) {
    void Promise.resolve().then(task).catch(error => report(errorMessage(error)));
  }
  function showDialog(next: Dialog) {
    if (next.kind === 'project') setStarter(false);
    setName(next.kind === 'rename' ? next.path.split('/').at(-1) ?? '' : '');
    setDialog(next);
  }
  function closeDialog() { setApiKey(''); setDialog(undefined); }

  useEffect(() => { select(undefined); setPreviewing(false); }, [model.project?.id]);
  useEffect(() => { if (model.active) setScreen('editor'); }, [model.active]);
  useEffect(() => {
    void workspace.getPreferences().then(raw => {
      if (!raw) return;
      const settings = JSON.parse(raw);
      setAutoSave(settings.autoSave === true);
      enableVoice(settings.voiceEnabled !== false);
      if (settings.language === 'en-US') setLanguage('en-US');
      if (typeof settings.rate === 'number' && settings.rate >= .6 && settings.rate <= 1.6) setRate(settings.rate);
    }).catch(error => report(errorMessage(error))).finally(() => setPreferencesReady(true));
  }, []);
  useEffect(() => {
    if (preferencesReady) {
      void workspace.putPreferences(JSON.stringify({ autoSave, voiceEnabled, language, rate }))
        .catch(error => report(errorMessage(error)));
    }
  }, [preferencesReady, autoSave, voiceEnabled, language, rate]);
  useEffect(() => {
    if (!voiceEnabled || tutor.progress.session.paused) {
      voiceGeneration.current++;
      setSpeaking(false);
      void voice.stop();
    }
  }, [voiceEnabled, tutor.progress.session.paused, model.project?.id]);

  useEffect(() => {
    if (!model.ready || !active || !/\.[cm]?[jt]sx?$/i.test(active.path)) return;
    const timer = setTimeout(() => {
      model.editor.current?.send({ type: 'diagnostics', id: active.id, diagnostics: semantics.diagnostics(active.path, active.text) });
    }, 400);
    return () => clearTimeout(timer);
  }, [active?.id, active?.text, model.ready]);

  useEffect(() => {
    if (!model.ready || !active) return;
    const target = tutor.step?.file === active.path ? tutor.step : undefined;
    let range = null;
    if (!tutor.progress.session.paused && tutor.draft?.path === active.path && tutor.draft.before === active.text) {
      range = tutor.draft.range;
    } else if (!tutor.progress.session.paused && target?.anchor) {
      const from = active.text.indexOf(target.anchor);
      if (from !== -1 && active.text.indexOf(target.anchor, from + 1) === -1) range = { from, to: from + target.anchor.length };
    } else if (!tutor.progress.session.paused && (target?.line || tutor.lesson?.file === active.path)) {
      const prior = active.text.split('\n').slice(0, (target?.line ?? 1) - 1);
      const from = prior.length ? prior.join('\n').length + 1 : 0;
      if (from <= active.text.length) range = { from, to: from };
    }
    const mark = range ? [active.id, target?.title ?? tutor.lesson?.id, tutor.draft?.path ?? ''].join(':') : '';
    model.editor.current?.send({ type: 'mark', id: active.id, range, reveal: !!mark && mark !== lastRevealed.current });
    lastRevealed.current = mark;
  }, [model.ready, active?.id, active?.text, tutor.step, tutor.lesson, tutor.draft, tutor.progress.session.paused]);

  function say(text: string) {
    if (!voiceEnabled) { report('语音已关闭，可在设置中开启。'); return; }
    const id = ++voiceGeneration.current;
    if (speaking) { setSpeaking(false); void voice.stop(); return; }
    const complete = () => { if (voiceGeneration.current === id) setSpeaking(false); };
    setSpeaking(true);
    voice.speak(text.slice(0, 3900), {
      language, rate, onDone: complete, onStopped: complete,
      onError: () => { complete(); report('Android TTS 无法朗读，请检查系统语音引擎和语言。'); },
    });
  }

  async function submitName() {
    if (!dialog || !name.trim()) return;
    const value = name.trim();
    const request = dialog;
    closeDialog();
    if (request.kind === 'project') await model.choose(value, starter);
    else if (request.kind === 'rename') { await model.mutate(request.path, value); select(undefined); }
    else if (request.kind === 'folder' || request.kind === 'file') await model.create(request.path, value, request.kind === 'folder');
  }

  async function openLocal(source: 'react' | 'built') {
    const project = model.project;
    if (!project || model.busy || buildingPreview) return;
    setBuildingPreview(true);
    report('');
    try {
      if (!await confirm('在设备浏览器预览', '浏览器会执行已保存项目中的脚本。请确认你信任这份代码。', '打开预览')) return;
      const url = source === 'react'
        ? await workspace.reactPreview(project.id, await buildReactSnapshot(workspace, project, reactRuntime), true)
        : await workspace.preview(project.id, true);
      try {
        await Linking.openURL(url);
        setPreviewing(true);
        closeDialog();
      } catch (error) {
        await workspace.stopPreview();
        setPreviewing(false);
        throw error;
      }
    } finally {
      setBuildingPreview(false);
    }
  }

  async function openExternal(kind: 'device' | 'remote') {
    const url = kind === 'device' ? await workspace.validateDevicePreview(deviceServer.trim())
      : await workspace.validateRemotePreview(remote.trim());
    const origin = url.split(/[/?#]/).slice(0, 3).join('/');
    if (!await confirm('打开外部开发预览', '在系统浏览器打开 ' + origin + '？', '打开')) return;
    await Linking.openURL(url);
    closeDialog();
  }

  const tree = <FileTree model={model} width={wide ? treeWidth : width} selected={selected} select={select} action={showDialog} run={run} onFileOpened={() => setScreen('editor')} />;
  const tutorPanel = <TutorPane model={model} tutor={tutor} width={wide ? Math.min(335, Math.floor(width * .34)) : width}
    run={run} say={say} speaking={speaking} />;

  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
    <StatusBar barStyle="light-content" />
    <View style={{ borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, padding: 8, gap: 6 }}>
      <View style={styles.line}>
        <Text numberOfLines={1} style={[styles.heading, { flex: 1 }]}>{model.project?.name ?? 'Code Tutor Studio'}</Text>
        <Button disabled={model.busy} onPress={() => run(() => model.choose(null))}>打开</Button>
        <Button disabled={model.busy} onPress={() => showDialog({ kind: 'project' })}>新建</Button>
        <Button onPress={() => showDialog({ kind: 'run' })}>运行</Button>
        <Button disabled={!active || active.saved === active.text || model.busy} onPress={() => run(() => model.save(model.active))}>保存</Button>
        <Button disabled={!preferencesReady} onPress={() => {
          setDialog({ kind: 'settings' });
          run(async () => setKeySaved(!!await credentials.load()));
        }}>设置</Button>
      </View>
      <View style={styles.wrap}>
        <Button selected={wide ? showFiles : screen === 'files'} onPress={() => wide ? setShowFiles(value => !value) : setScreen('files')}>文件树</Button>
        {!wide && <Button selected={screen === 'editor'} onPress={() => setScreen('editor')}>编辑器</Button>}
        <Button selected={wide ? showTutor : screen === 'tutor'} onPress={() => wide ? setShowTutor(value => !value) : setScreen('tutor')}>教学</Button>
        <Button selected={showTerminal} onPress={() => setShowTerminal(value => !value)}>终端</Button>
        {previewing && <Button onPress={() => run(async () => { await workspace.stopPreview(); setPreviewing(false); })}>停止预览</Button>}
        {!!message && <Text accessibilityLiveRegion="polite" selectable style={[styles.muted, { flexShrink: 1 }]}>{message}</Text>}
      </View>
    </View>
    <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
      {(wide ? showFiles : screen === 'files') && tree}
      {wide && showFiles && <View
        accessibilityLabel="调整文件树宽度" accessibilityRole="adjustable"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => setTreeWidth(value => Math.max(170, Math.min(340, value + (event.nativeEvent.actionName === 'increment' ? 20 : -20))))}
        onStartShouldSetResponder={() => true}
        onResponderGrant={event => { drag.current = { x: event.nativeEvent.pageX, width: treeWidth }; }}
        onResponderMove={event => setTreeWidth(Math.max(170, Math.min(340, drag.current.width + event.nativeEvent.pageX - drag.current.x)))}
        style={{ width: 10, backgroundColor: colors.border }} />}
      <View style={{ flex: 1, display: visibleEditor ? 'flex' : 'none', minWidth: 0 }}>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 3, padding: 5 }}>
          {model.tabs.map(tab => <View key={tab.path} style={styles.line}>
            <Button selected={tab.path === model.active} label={'打开标签 ' + tab.path} onPress={() => run(() => model.open(tab.path))}>
              {tab.path.split('/').at(-1)}{tab.saved !== tab.text ? ' •' : ''}{tab.readOnly ? ' ⌑' : ''}
            </Button>
            <Button label={'关闭标签 ' + tab.path} onPress={() => run(() => model.close(tab.path))}>×</Button>
          </View>)}
        </ScrollView>
        {!!active && <View style={[styles.wrap, { paddingHorizontal: 5, paddingBottom: 4 }]}>
          <Text numberOfLines={1} style={[styles.muted, { flex: 1 }]}>{active.path}{active.readOnly ? ' · 只读' : ''}</Text>
          <Button disabled={!model.ready || active.readOnly} onPress={() => model.editor.current?.send({ type: 'undo', id: active.id })}>撤销</Button>
          <Button disabled={!model.ready || active.readOnly} onPress={() => model.editor.current?.send({ type: 'redo', id: active.id })}>重做</Button>
          <Button disabled={!model.ready} selected={wrapLines} onPress={() => setWrapLines(value => !value)}>换行</Button>
          <Button disabled={model.busy} onPress={() => run(async () => {
            if (await confirm('重读磁盘版本', '此操作会丢弃这个标签的未保存编辑。', '重读', true)) await model.open(active.path, true);
          })}>重读</Button>
        </View>}
        <View style={{ flex: 1, display: active ? 'flex' : 'none' }}>
          <Editor key={editorKey} ref={model.editor} onEvent={model.onEditorEvent} onFailure={value => {
            lastRevealed.current = '';
            model.resetEditor();
            setEditorKey(key => key + 1);
            report(value);
          }} />
        </View>
        {!active && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Text style={styles.heading}>{model.project ? '从文件树打开源码' : '打开 Android 项目目录'}</Text>
          <Text style={styles.muted}>{model.project ? '支持同时打开多个文件。' : '使用 Android 系统目录选择器授权读写。'}</Text>
        </View>}
      </View>
      {(wide ? showTutor : screen === 'tutor') && tutorPanel}
    </View>
    <View style={{ display: showTerminal ? 'flex' : 'none', height: Math.max(height < 450 ? 105 : 145, Math.min(height * .31, 270)), borderTopWidth: 1, borderColor: colors.border }}>
      <TerminalPane visible={showTerminal} />
    </View>
    <Modal visible={!!dialog} animationType="fade" transparent onRequestClose={closeDialog}>
      <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 520, maxHeight: '92%', backgroundColor: colors.panel, borderRadius: 10, padding: 15 }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
            {dialog?.kind === 'settings' ? <>
              <Text style={styles.heading}>设置</Text>
              <View style={styles.line}><Text style={[styles.text, { flex: 1 }]}>自动保存</Text><Switch accessibilityLabel="自动保存" value={autoSave} onValueChange={setAutoSave} /></View>
              <View style={styles.line}><Text style={[styles.text, { flex: 1 }]}>语音朗读</Text><Switch accessibilityLabel="语音朗读" value={voiceEnabled} onValueChange={enableVoice} /></View>
              <Text style={styles.muted}>语速 {rate.toFixed(1)} · 语言</Text>
              <View style={styles.wrap}>
                <Button onPress={() => setRate(value => Math.max(.6, value - .1))}>慢一点</Button>
                <Button onPress={() => setRate(value => Math.min(1.6, value + .1))}>快一点</Button>
                <Button selected={language === 'zh-CN'} onPress={() => setLanguage('zh-CN')}>中文</Button>
                <Button selected={language === 'en-US'} onPress={() => setLanguage('en-US')}>English</Button>
              </View>
              <Text style={styles.muted}>OpenAI API Key · {keySaved ? '已加密保存' : '未设置'}</Text>
              <TextInput accessibilityLabel="OpenAI API Key" secureTextEntry autoCorrect={false} autoCapitalize="none"
                value={apiKey} onChangeText={setApiKey} style={styles.input} />
              <View style={styles.wrap}>
                <Button disabled={!apiKey.trim()} onPress={() => run(async () => {
                  await credentials.save(apiKey); setApiKey(''); setKeySaved(true); report('API Key 已保存。');
                })}>保存密钥</Button>
                <Button disabled={!keySaved} onPress={() => run(async () => {
                  if (await confirm('清除设备上的 API Key', '下次请求 AI 教学前需要重新设置。', '清除', true)) {
                    await credentials.save(''); setKeySaved(false);
                  }
                })}>清除密钥</Button>
              </View>
            </> : dialog?.kind === 'run' ? <>
              <Text style={styles.heading}>运行与预览</Text>
              <Text style={styles.text}>本机 React 模板会编译已保存的 TS/TSX 并启动回环预览。保存修改后重新运行，浏览器会显示新版本。</Text>
              <Button disabled={!model.project || model.busy || buildingPreview} onPress={() => run(() => openLocal('react'))} selected>
                {buildingPreview ? '正在准备预览…' : '从源码运行 React 模板'}
              </Button>
              <Button disabled={!model.project || model.busy || buildingPreview} onPress={() => run(() => openLocal('built'))}>预览静态网站或 dist/</Button>
              <Text style={styles.muted}>在 Termux 等独立环境手动安装依赖并启动 Vite 后，可打开设备回环地址。构建日志位于该环境的终端。</Text>
              <TextInput accessibilityLabel="设备开发服务器地址" value={deviceServer} onChangeText={setDeviceServer} style={styles.input}
                autoCapitalize="none" autoCorrect={false} />
              <Button disabled={!deviceServer.trim()} onPress={() => run(() => openExternal('device'))}>打开设备开发服务器</Button>
              <Text style={styles.muted}>远程构建由自管主机运行。启动后可打开 HTTPS 地址。</Text>
              <TextInput accessibilityLabel="HTTPS 开发预览地址" value={remote} onChangeText={setRemote} style={styles.input}
                autoCapitalize="none" autoCorrect={false} placeholder="HTTPS 开发预览地址" placeholderTextColor={colors.muted} />
              <Button disabled={!remote.trim()} onPress={() => run(() => openExternal('remote'))}>打开远程 HTTPS 预览</Button>
            </> : dialog && <>
              <Text style={styles.heading}>{dialog.kind === 'project' ? '新建项目' : dialog.kind === 'rename' ? '重命名' : dialog.kind === 'folder' ? '新建目录' : '新建文件'}</Text>
              {dialog.kind === 'project' && <Text style={styles.muted}>输入名称后，在 Android 目录选择器中选择项目的父目录。</Text>}
              {dialog.kind === 'project' && <View style={styles.wrap}>
                <Button selected={!starter} onPress={() => setStarter(false)}>空白项目</Button>
                <Button selected={starter} onPress={() => setStarter(true)}>React + TypeScript</Button>
              </View>}
              <TextInput accessibilityLabel="名称" value={name} onChangeText={setName} maxLength={255}
                autoCapitalize="none" autoCorrect={false} style={styles.input} onSubmitEditing={() => run(submitName)} />
              <Button disabled={!name.trim()} onPress={() => run(submitName)} selected>继续</Button>
            </>}
            {!!message && <Text selectable accessibilityLiveRegion="polite" style={styles.muted}>{message}</Text>}
            <Button onPress={closeDialog}>关闭</Button>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}
