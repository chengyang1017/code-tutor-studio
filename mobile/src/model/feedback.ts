import { Alert } from 'react-native';

export function confirm(title: string, message: string, label = '确认', destructive = false): Promise<boolean> {
  return new Promise(resolve => Alert.alert(title, message, [
    { text: '取消', style: 'cancel', onPress: () => resolve(false) },
    { text: label, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
