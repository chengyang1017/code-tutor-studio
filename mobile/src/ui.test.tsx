import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, DiffPreview } from './ui';

test('shows the actual edit and requires explicit application', () => {
  const onApply = jest.fn();
  const onCancel = jest.fn();
  render(<DiffPreview path="src/App.tsx" removed="return null" added="return <h1>Todo</h1>" onApply={onApply} onCancel={onCancel} />);
  expect(screen.getByText('src/App.tsx')).toBeTruthy();
  expect(screen.getByText('− return null')).toBeTruthy();
  expect(screen.getByText('+ return <h1>Todo</h1>')).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: '取消' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: '确认应用到编辑器' }));
  expect(onApply).toHaveBeenCalledTimes(1);
});

test('disables a toolbar action when prerequisites are missing', () => {
  const save = jest.fn();
  const view = render(<Button disabled onPress={save}>保存</Button>);
  fireEvent.press(screen.getByRole('button', { name: '保存' }));
  expect(save).not.toHaveBeenCalled();
  view.rerender(<Button onPress={save}>保存</Button>);
  fireEvent.press(screen.getByRole('button', { name: '保存' }));
  expect(save).toHaveBeenCalledTimes(1);
});
