import { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { isClearCommand } from '../../shared/core/terminal';
import { workspace } from './platform/workspace';
import { confirm, errorMessage } from './model/feedback';
import { Button, colors, styles } from './ui';

export function TerminalPane({ visible }: { visible: boolean }) {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [cwd, setCwd] = useState('');
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const active = useRef('');
  const counter = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const followOutput = useRef(true);
  const append = (text: string) => setOutput(previous => (previous + text).replace(/\r\n/g, '\n').slice(-64000));

  useEffect(() => {
    const listener = workspace.addListener('terminalEvent', event => {
      if (event.id !== active.current) return;
      if (event.kind === 'output') append(event.text);
      else {
        append('\n[退出码 ' + event.code + ']\n');
        active.current = '';
        setRunning(false);
        setStopping(false);
      }
    });
    void workspace.terminalDirectory().then(setCwd).catch(error => append(errorMessage(error)));
    return () => {
      listener.remove();
      if (active.current) void workspace.stop(active.current).catch(() => {});
    };
  }, []);

  async function send(data: string) {
    const id = active.current;
    if (id && !stopping) await workspace.terminalInput(id, data).catch(error => append(errorMessage(error) + '\n'));
  }

  async function stop() {
    const id = active.current;
    if (!id || stopping) return;
    setStopping(true);
    try { await workspace.stop(id); }
    catch (error) { setStopping(false); append(errorMessage(error) + '\n'); }
  }

  async function submit() {
    if (active.current) {
      if (stopping) return;
      setInput('');
      await send(input + '\n');
      return;
    }
    const command = input.trim();
    if (!command || active.current) return;
    if (isClearCommand(command)) { setInput(''); setOutput(''); return; }
    if (!await confirm('运行本地命令', command, '运行') || active.current) return;
    const id = String(++counter.current);
    active.current = id;
    setRunning(true);
    setInput('');
    append('\n$ ' + command + '\n');
    try { await workspace.run(id, command, true); }
    catch (error) {
      if (active.current === id) { active.current = ''; setRunning(false); }
      append(errorMessage(error) + '\n');
    }
  }

  return <View style={{ display: visible ? 'flex' : 'none', flex: 1, backgroundColor: colors.background, padding: 8, gap: 4 }}>
    <View style={styles.line}>
      <Text numberOfLines={1} style={[styles.muted, { flex: 1 }]}>终端 · {cwd || '应用私有目录'}</Text>
      <Button onPress={() => { void Clipboard.setStringAsync(output); }}>复制</Button>
      {running && <Text style={styles.muted}>{stopping ? '正在停止' : 'PTY 运行中'}</Text>}
      <Button disabled={!running || stopping} onPress={() => { void send('\u0003'); }}>Ctrl+C</Button>
      <Button disabled={!running || stopping} onPress={() => { void send('\u0004'); }}>EOF</Button>
      <Button disabled={!running || stopping} onPress={() => { void stop(); }}>停止</Button>
    </View>
    <ScrollView ref={scroll} scrollEventThrottle={64}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) void workspace.resizeTerminal(Math.floor(height / 20), Math.floor(width / 8))
          .catch(error => append(errorMessage(error) + '\n'));
      }}
      onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
        followOutput.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 30;
      }}
      onContentSizeChange={() => { if (followOutput.current) scroll.current?.scrollToEnd({ animated: false }); }}
      keyboardShouldPersistTaps="handled">
      <Text selectable style={styles.code}>{output || 'Android Toybox PTY。试试 tty，或运行 cat 后发送一行输入并按 EOF。文件操作限终端沙箱。'}</Text>
    </ScrollView>
    <View style={styles.line}>
      <TextInput accessibilityLabel={running ? '进程标准输入' : '终端命令'} value={input} onChangeText={setInput}
        onSubmitEditing={() => { void submit(); }} submitBehavior={running ? 'submit' : 'blurAndSubmit'}
        autoCapitalize="none" autoCorrect={false} maxLength={running ? 240 : 512}
        placeholder={running ? '输入一行发送给进程' : '输入命令'} placeholderTextColor={colors.muted}
        style={[styles.input, styles.code, { flex: 1 }]} />
      <Button disabled={stopping} onPress={() => { void submit(); }}>{running ? '发送' : '执行'}</Button>
    </View>
  </View>;
}
