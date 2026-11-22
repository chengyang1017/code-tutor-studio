import { forwardRef, useImperativeHandle, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { EditorCommand, EditorEvent } from './protocol';
import { decodeEditorEvent } from './protocol';
import { editorHtml } from './generated';

const origin = 'https://editor.codetutor.invalid';
const source = { html: editorHtml, baseUrl: origin + '/' };

export type EditorHandle = { send(command: EditorCommand): void };

export const Editor = forwardRef<EditorHandle, { onEvent(event: EditorEvent): void; onFailure(message: string): void }>(
  function Editor({ onEvent, onFailure }, ref) {
    const webView = useRef<WebView>(null);
    useImperativeHandle(ref, () => ({
      send(command) {
        const data = JSON.stringify(command).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        webView.current?.injectJavaScript('window.codeTutorEditor?.receive(' + data + '); true;');
      },
    }), []);

    return <WebView
      ref={webView}
      source={source}
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === origin + '/'}
      onMessage={event => {
        const url = event.nativeEvent.url;
        if (url !== origin + '/' && url !== origin && url !== 'about:blank') return;
        const message = decodeEditorEvent(event.nativeEvent.data);
        if (message) onEvent(message);
      }}
      onRenderProcessGone={() => onFailure('编辑器进程已停止。请重新加载编辑器。')}
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      domStorageEnabled={false}
      mixedContentMode="never"
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      style={{ flex: 1, backgroundColor: '#111a28' }}
    />;
  },
);
