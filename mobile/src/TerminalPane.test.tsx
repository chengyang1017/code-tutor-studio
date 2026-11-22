import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { TerminalPane } from './TerminalPane';
import { workspace } from './platform/workspace';
import type { TerminalEvent } from './platform/workspace';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('./platform/workspace', () => ({
  workspace: {
    terminalDirectory: jest.fn(async () => '/private/terminal'),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    run: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
  },
}));

test('terminal waits for confirmation and displays adapter output and exit status', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    render(<TerminalPane visible />);
    await screen.findByText('终端 · /private/terminal');
    fireEvent.changeText(screen.getByLabelText('终端命令'), 'pwd');
    fireEvent.press(screen.getByRole('button', { name: '执行' }));
    expect(workspace.run).not.toHaveBeenCalled();

    alert.mock.calls.at(-1)?.[2]?.find(button => button.text === '运行')?.onPress?.();
    await waitFor(() => expect(workspace.run).toHaveBeenCalledWith('1', 'pwd', true));

    const listener = jest.mocked(workspace.addListener).mock.calls[0][1];
    const output: TerminalEvent = { id: '1', kind: 'output', text: '/private/terminal\n' };
    const exit: TerminalEvent = { id: '1', kind: 'exit', code: 0 };
    await act(async () => { listener(output); listener(exit); });
    expect(screen.getByText(/退出码 0/)).toBeTruthy();
  } finally {
    alert.mockRestore();
  }
});
