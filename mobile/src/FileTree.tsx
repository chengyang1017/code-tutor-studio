import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Entry } from './platform/workspace';
import type { WorkspaceModel } from './model/useProject';
import { Button, colors, styles } from './ui';

export type FileAction = { kind: 'file' | 'folder' | 'rename'; path: string };

export function FileTree({ model, width, selected, select, action, run, onFileOpened }: {
  model: WorkspaceModel; width: number; selected?: Entry; select(entry: Entry): void;
  action(value: FileAction): void; onFileOpened(): void; run(work: () => unknown): void;
}) {
  const parent = selected?.directory ? selected.path : selected?.path.split('/').slice(0, -1).join('/') ?? '';

  function rows(path: string, depth: number): React.ReactNode {
    return (model.dirs[path] ?? []).map(entry => {
      const open = model.expanded.includes(entry.path);
      return <View key={entry.path}>
        <Pressable accessibilityRole="button" accessibilityLabel={entry.path}
          accessibilityState={{ selected: selected?.path === entry.path, expanded: entry.directory ? open : undefined }}
          onPress={() => {
            select(entry);
            run(async () => {
              if (entry.directory) await model.toggleDirectory(entry.path);
              else if (await model.open(entry.path)) onFileOpened();
            });
          }}
          onLongPress={() => select(entry)}
          style={{ paddingVertical: 9, paddingLeft: 8 + Math.min(8, depth) * 11, paddingRight: 6,
            backgroundColor: selected?.path === entry.path ? colors.secondary : 'transparent' }}>
          <Text numberOfLines={1} style={{ color: entry.directory ? colors.teal : colors.text }}>
            {entry.directory ? open ? '▾  ' : '▸  ' : '    '}{entry.path.split('/').at(-1)}
          </Text>
        </Pressable>
        {entry.directory && open && rows(entry.path, depth + 1)}
      </View>;
    });
  }

  return <View style={{ width, backgroundColor: colors.panel, gap: 8, padding: 8 }}>
    <View style={styles.line}>
      <Text style={[styles.heading, { flex: 1 }]}>项目文件</Text>
      <Button onPress={() => run(model.refreshRoot)} label="刷新项目根目录">刷新</Button>
    </View>
    <View style={styles.wrap}>
      <Button disabled={!model.project || model.busy} onPress={() => action({ kind: 'file', path: parent })}>新建文件</Button>
      <Button disabled={!model.project || model.busy} onPress={() => action({ kind: 'folder', path: parent })}>新建目录</Button>
      {selected && <>
        <Button disabled={model.busy} onPress={() => action({ kind: 'rename', path: selected.path })}>重命名</Button>
        <Button disabled={model.busy} onPress={() => run(() => model.mutate(selected.path))}>删除</Button>
      </>}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled">
      {!model.project ? <Text style={styles.muted}>请选择项目目录。</Text> : rows('', 0)}
    </ScrollView>
  </View>;
}
