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
  const active = useRef('');
  const counter = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const append = (text: string) => setOutput(previous => (previous + text).slice(-64000));

  useEffect(() => {
    const listener = workspace.addListener('terminalEvent', event => {
      if (event.id !== active.current) return;
      if (event.kind === 'output') append(event.text);
      else {
        append('\n[退出码 ' + event.code + ']\n');
        active.current = '';
        setRunning(false);
      }
    });
    void workspace.terminalDirectory().then(setCwd).catch(error => append(errorMessage(error)));
    return () => listener.remove();
  }, []);

  async function submit() {
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
      <Button disabled={!running} onPress={() => { void workspace.stop().catch(error => append(errorMessage(error))); }}>停止</Button>
    </View>
    <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
      <Text selectable style={styles.code}>{output || 'Android Toybox：pwd、ls、date、id、uname、df、sleep 1–30。工作目录为应用沙箱。'}</Text>
    </ScrollView>
    <View style={styles.line}>
      <TextInput accessibilityLabel="终端命令" value={input} onChangeText={setInput} onSubmitEditing={() => { void submit(); }}
        autoCapitalize="none" autoCorrect={false} maxLength={512} placeholder="输入命令" placeholderTextColor={colors.muted}
        style={[styles.input, styles.code, { flex: 1 }]} />
      <Button disabled={running} onPress={() => { void submit(); }}>执行</Button>
    </View>
  </View>;
}
