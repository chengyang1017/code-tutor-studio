import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { WorkspaceModel } from './model/useProject';
import type { useTeaching } from './model/useTeaching';
import { Button, colors, DiffPreview, Robot, styles } from './ui';

export function TutorPane({ width, model, tutor, speaking, say, run }: {
  width: number; model: WorkspaceModel; tutor: ReturnType<typeof useTeaching>; speaking: boolean; say(text: string): void;
  run(work: () => unknown): void;
}) {
  const [mode, setMode] = useState<'course' | 'ai'>('course');
  const [goal, setGoal] = useState('');
  const { progress, lesson, step, reference, draft } = tutor;
  const paused = progress.session.paused;
  const blocked = !model.project || paused || tutor.running || model.busy;
  useEffect(() => { setGoal(progress.session.goal); }, [model.project?.id, progress.session.goal]);

  return <View style={{ width, backgroundColor: colors.panel, padding: 10, gap: 6 }}>
    <View style={styles.line}>
      <Robot speaking={speaking} paused={paused} working={tutor.running} />
      <View style={{ flex: 1 }}>
        <Text style={styles.heading}>教学机器人</Text>
        <Text style={styles.muted}>{paused ? '已暂停' : tutor.running ? '等待 AI 响应' : speaking ? '正在朗读' : '源代码教学'}</Text>
      </View>
      <Button disabled={!model.project || model.busy} onPress={tutor.pause}>{paused ? '恢复' : '暂停'}</Button>
    </View>
    <View style={styles.wrap}>
      <Button selected={mode === 'course'} onPress={() => setMode('course')}>React 课程</Button>
      <Button selected={mode === 'ai'} onPress={() => setMode('ai')}>AI 指导</Button>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled">
      <View style={{ gap: 9, paddingBottom: 20 }}>
        {!model.project && <Text style={styles.muted}>打开项目后，机器人可以定位和验证你的源码。</Text>}
        {mode === 'course' && (lesson ? <>
          <Text style={styles.heading}>{lesson.title}</Text>
          <Text style={styles.text}>{lesson.objective}</Text>
          <Text style={styles.muted}>{lesson.file}</Text>
          <Text selectable style={styles.text}>{lesson.instruction}</Text>
          <Text selectable style={styles.muted}>{lesson.hint}</Text>
          <View style={styles.wrap}>
            <Button disabled={blocked} onPress={() => run(() => model.open(lesson.file))}>定位文件</Button>
            <Button disabled={blocked} onPress={() => run(() => tutor.verifyCourse(model))}>验证</Button>
            <Button disabled={blocked || !progress.coursePassed} onPress={() => run(() => tutor.nextCourse(model))}>下一课</Button>
            <Button disabled={blocked} onPress={() => say(lesson.explanation + lesson.instruction)}>{speaking ? '停止朗读' : '朗读'}</Button>
          </View>
        </> : <Text style={styles.text}>React Todo 课程已完成。</Text>)}
        {mode === 'ai' && <>
          <TextInput accessibilityLabel="项目教学目标" maxLength={1000} value={goal} onChangeText={setGoal}
            placeholder="项目教学目标" placeholderTextColor={colors.muted} multiline style={styles.input} />
          {step && <>
            <Text style={styles.heading}>{step.title}</Text>
            <Text style={styles.muted}>第 {progress.session.completed + 1} 步 · {step.file}</Text>
            <Text selectable style={styles.text}>{step.instruction}</Text>
          </>}
          <View style={styles.wrap}>
            <Button disabled={blocked || !!step && !progress.aiPassed} onPress={() => run(() => tutor.ask('next', model, goal))}>{step ? '下一步' : '开始教学'}</Button>
            {step && <>
              <Button disabled={!model.project || model.busy || tutor.running} onPress={() => run(tutor.resetAi)}>重新开始</Button>
              <Button disabled={blocked} onPress={() => run(() => model.open(step.file))}>定位源码</Button>
              <Button disabled={blocked} onPress={() => run(() => tutor.ask('reference', model, goal))}>给我参考</Button>
              <Button disabled={blocked} onPress={() => run(() => tutor.ask('verify', model, goal))}>验证步骤</Button>
              <Button disabled={blocked} onPress={() => say(step.instruction)}>{speaking ? '停止朗读' : '朗读'}</Button>
            </>}
          </View>
          {reference && <View style={styles.diff}>
            <Text style={styles.heading}>参考代码</Text>
            <Text selectable style={styles.code}>{reference.example}</Text>
            <Button disabled={blocked || !model.ready} onPress={() => run(() => tutor.showPreview(model))}>定位并预览补全</Button>
          </View>}
          {draft && <DiffPreview path={draft.path} removed={draft.removed} added={draft.added}
            onApply={() => run(() => tutor.apply(model))} onCancel={tutor.discardPreview} />}
        </>}
        {!!tutor.feedback && <Text selectable style={styles.text}>{tutor.feedback}</Text>}
      </View>
    </ScrollView>
  </View>;
}
