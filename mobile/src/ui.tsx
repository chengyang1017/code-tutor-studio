import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export const colors = {
  background: '#0d1420', panel: '#142033', secondary: '#1c2b41', border: '#2a3c55',
  text: '#e8effb', muted: '#a5b7cf', teal: '#86e6ca', danger: '#ffaaaa',
};

export function Button({ children, onPress, disabled, selected, label }: {
  children: ReactNode; onPress(): void; disabled?: boolean; selected?: boolean; label?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }}
    onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, selected && styles.buttonSelected, (pressed || disabled) && styles.faded]}>
    <Text style={[styles.buttonText, selected && { color: colors.teal }]}>{children}</Text>
  </Pressable>;
}

export function Robot({ speaking, working, paused }: { speaking: boolean; working: boolean; paused: boolean }) {
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (paused) { bob.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: -4, duration: working || speaking ? 360 : 900, useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: working || speaking ? 360 : 900, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [bob, paused, speaking, working]);
  return <View style={styles.robotShell} accessibilityLabel={paused ? '机器人已暂停' : speaking ? '机器人正在朗读' : '教学机器人'}>
    <Animated.View style={[styles.robot, { transform: [{ translateY: bob }] }]}>
      <View style={styles.antenna} />
      <View style={styles.eyes}><View style={styles.eye} /><View style={styles.eye} /></View>
      <View style={[styles.mouth, speaking && { height: 7 }]} />
    </Animated.View>
  </View>;
}

export function DiffPreview({ path, removed, added, onApply, onCancel }: {
  path: string; removed: string; added: string; onApply(): void; onCancel(): void;
}) {
  return <View style={styles.diff}>
    <Text style={styles.heading}>差异预览</Text>
    <Text style={styles.muted}>{path}</Text>
    <ScrollView nestedScrollEnabled style={{ maxHeight: 190 }}>
      {!!removed && <Text selectable style={[styles.code, { color: colors.danger }]}>{removed.split('\n').map(line => '− ' + line).join('\n')}</Text>}
      {!!added && <Text selectable style={[styles.code, { color: colors.teal }]}>{added.split('\n').map(line => '+ ' + line).join('\n')}</Text>}
    </ScrollView>
    <View style={styles.wrap}><Button onPress={onApply} selected>确认应用到编辑器</Button><Button onPress={onCancel}>取消</Button></View>
  </View>;
}

export const styles = StyleSheet.create({
  button: { minHeight: 40, backgroundColor: colors.secondary, borderColor: colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
  buttonSelected: { borderColor: '#4d927f', backgroundColor: '#1b3a3c' },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  faded: { opacity: .5 },
  text: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  heading: { color: colors.text, fontSize: 15, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, padding: 10, borderRadius: 6, minHeight: 42 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  line: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  code: { fontFamily: 'monospace', color: colors.text, fontSize: 13, lineHeight: 20 },
  diff: { padding: 10, backgroundColor: colors.background, borderRadius: 6, borderWidth: 1, borderColor: colors.border, gap: 6 },
  robotShell: { width: 47, height: 49, justifyContent: 'center', alignItems: 'center' },
  robot: { width: 37, height: 31, marginTop: 8, borderRadius: 9, backgroundColor: '#315c68', borderWidth: 1, borderColor: colors.teal, alignItems: 'center' },
  antenna: { position: 'absolute', top: -8, width: 4, height: 8, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: colors.teal },
  eyes: { flexDirection: 'row', gap: 8, marginTop: 8 },
  eye: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.teal },
  mouth: { marginTop: 4, width: 10, height: 2, borderRadius: 3, backgroundColor: colors.teal },
});
