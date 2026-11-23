package com.chengyang.codetutor.workspace;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class PreviewServer implements AutoCloseable {
    private static final String ERROR_PANEL = """
        <script>
        (() => {
          const messages = [];
          function report(message) {
            if (messages.length === 8) return;
            messages.push(String(message).slice(0, 800));
            const show = () => {
              let panel = document.getElementById('codetutor-preview-errors');
              if (!panel) {
                panel = document.createElement('pre');
                panel.id = 'codetutor-preview-errors';
                panel.style.cssText = 'position:fixed;z-index:2147483647;inset:auto 12px 12px;max-height:40vh;overflow:auto;background:#321d25;color:#fff;padding:12px;white-space:pre-wrap';
                panel.setAttribute('role', 'alert');
                document.body.append(panel);
              }
              panel.textContent = '浏览器预览错误\\n' + messages.join('\\n');
            };
            if (document.body) show();
            else document.addEventListener('DOMContentLoaded', show, { once: true });
          }
          window.addEventListener('error', event => {
            const message = event.message || event.target?.src || event.target?.href;
            if (message) report(message);
          }, true);
          window.addEventListener('unhandledrejection', event => report(event.reason));
        })();
        </script>
        """;
    private static final Map<String, String> TYPES = Map.ofEntries(
        Map.entry("html", "text/html; charset=utf-8"), Map.entry("js", "text/javascript; charset=utf-8"),
        Map.entry("mjs", "text/javascript; charset=utf-8"), Map.entry("css", "text/css; charset=utf-8"),
        Map.entry("json", "application/json"), Map.entry("svg", "image/svg+xml"), Map.entry("png", "image/png"),
        Map.entry("jpg", "image/jpeg"), Map.entry("jpeg", "image/jpeg"), Map.entry("webp", "image/webp"),
        Map.entry("gif", "image/gif"), Map.entry("avif", "image/avif"), Map.entry("ico", "image/x-icon"),
        Map.entry("wasm", "application/wasm"), Map.entry("woff", "font/woff"), Map.entry("woff2", "font/woff2"));
    private final String token = UUID.randomUUID().toString();
    private final ServerSocket server;
    private final String address;
    private final String cookie;
    private final ThreadPoolExecutor requests = new ThreadPoolExecutor(2, 4, 10, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16));
    private final java.util.Set<Socket> clients = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final long expiry = System.nanoTime() + TimeUnit.MINUTES.toNanos(30);

    private record Asset(String type, byte[] data) {}
    @FunctionalInterface private interface Content { Asset load(String path) throws Exception; }

    PreviewServer(ProjectFiles files, ProjectFiles.PreviewRoot root) throws IOException {
        this(path -> {
            String type = TYPES.get(extension(path));
            if (type == null) throw new IOException("Unsupported preview resource");
            return new Asset(type, files.previewFile(root, path));
        });
    }

    static PreviewServer forReactSnapshot(Map<String, String> source) throws IOException {
        Map<String, Asset> assets = new java.util.HashMap<>();
        int total = 0;
        if (source.size() > 70 || !source.containsKey("index.html")) throw new IOException("预览快照无效");
        for (var entry : source.entrySet()) {
            String path = entry.getKey();
            if (!path.equals("index.html") && !path.matches("(?:src|__ct)/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*")) {
                throw new IOException("预览快照包含无效路径");
            }
            String ext = extension(path);
            String type = ext.matches("[jt]sx?") ? TYPES.get("js") : TYPES.get(ext);
            if (type == null) throw new IOException("预览快照包含不支持的文件类型");
            byte[] data = entry.getValue().getBytes(StandardCharsets.UTF_8);
            total += data.length;
            if (total > 2 * 1024 * 1024) throw new IOException("预览快照超过 2 MiB");
            assets.put(path, new Asset(type, data));
        }
        return new PreviewServer(path -> {
            Asset exact = assets.get(path);
            if (exact != null) return exact;
            Asset candidate = null;
            for (String suffix : new String[] {".tsx", ".ts", ".jsx", ".js", ".mjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"}) {
                Asset match = assets.get(path + suffix);
                if (match == null) continue;
                if (candidate != null) throw new IOException("Ambiguous module");
                candidate = match;
            }
            if (candidate == null) throw new IOException("Missing module");
            return candidate;
        });
    }

    private static String extension(String path) {
        return path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    }

    private PreviewServer(Content content) throws IOException {
        server = new ServerSocket(0, 16, InetAddress.getByAddress(new byte[] {127, 0, 0, 1}));
        address = "127.0.0.1:" + server.getLocalPort();
        cookie = "codetutor_" + server.getLocalPort() + "=" + token;
        server.setSoTimeout(1000);
        new Thread(() -> serve(content), "code-tutor-preview").start();
    }

    String url() { return "http://" + address + "/__open/" + token; }

    private void serve(Content content) {
        try {
            while (!server.isClosed() && System.nanoTime() < expiry) {
                try {
                    Socket client = server.accept();
                    clients.add(client);
                    try { requests.execute(() -> respond(client, content)); }
                    catch (java.util.concurrent.RejectedExecutionException busy) { clients.remove(client); client.close(); }
                } catch (SocketTimeoutException idle) { /* Check the preview lifetime. */ }
            }
        } catch (IOException stopped) {
            // Closing the listener interrupts accept.
        } finally {
            close();
        }
    }

    private static String line(InputStream input, int max, long deadline) throws IOException {
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        int next;
        while (data.size() < max && System.nanoTime() < deadline && (next = input.read()) >= 0) {
            if (next == '\n') return new String(data.toByteArray(), StandardCharsets.US_ASCII).trim();
            data.write(next);
        }
        throw new IOException("Incomplete HTTP request");
    }

    private void respond(Socket client, Content content) {
        try (client) {
            client.setSoTimeout(2000);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            InputStream input = new BufferedInputStream(client.getInputStream());
            OutputStream output = client.getOutputStream();
            String[] request = line(input, 3000, deadline).split(" ", -1);
            if (request.length != 3 || !request[0].equals("GET") || !request[1].startsWith("/")) {
                reply(output, "405 Method Not Allowed", "", new byte[0]); return;
            }
            String host = "";
            String fetchSite = "";
            String accept = "";
            boolean authenticated = false;
            for (int i = 0; i < 48; i++) {
                String header = line(input, 3000, deadline);
                if (header.isEmpty()) break;
                int separator = header.indexOf(':');
                if (separator < 0 || i == 47) return;
                String key = header.substring(0, separator).toLowerCase(Locale.ROOT);
                String value = header.substring(separator + 1).trim();
                if (key.equals("host")) host = value;
                if (key.equals("accept")) accept = value;
                if (key.equals("sec-fetch-site")) fetchSite = value;
                if (key.equals("cookie")) {
                    for (String part : value.split(";")) if (part.trim().equals(cookie)) authenticated = true;
                }
            }
            if (server.isClosed() || !address.equals(host) || fetchSite.equals("cross-site")) {
                reply(output, "403 Forbidden", "", new byte[0]); return;
            }
            URI target = URI.create(request[1]);
            if (target.getRawAuthority() != null || target.getRawFragment() != null) return;
            String path = target.getPath();
            if (path == null) return;
            if (path.equals("/__open/" + token)) {
                reply(output, "303 See Other", "Location: /\r\nSet-Cookie: " + cookie +
                    "; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800\r\n", new byte[0]); return;
            }
            if (!authenticated) { reply(output, "403 Forbidden", "", new byte[0]); return; }
            path = path.equals("/") ? "index.html" : path.substring(1);
            for (String part : path.split("/", -1)) {
                if (part.startsWith(".") || part.matches("(?i)(?:node_modules|.*(?:secret|credential|password).*)")) {
                    reply(output, "404 Not Found", "", new byte[0]); return;
                }
            }
            if (accept.contains("text/html") && !path.substring(path.lastIndexOf('/') + 1).contains(".")) {
                path = "index.html";
            }
            if (path.indexOf('\\') >= 0) { reply(output, "404 Not Found", "", new byte[0]); return; }
            Asset asset;
            try { asset = content.load(path); }
            catch (Exception error) { reply(output, "404 Not Found", "", new byte[0]); return; }
            byte[] bytes = asset.data();
            if (extension(path).equals("html")) {
                String html = new String(bytes, StandardCharsets.UTF_8);
                java.util.regex.Matcher head = java.util.regex.Pattern.compile("(?i)<head(?:\\s+[^>]*)?>").matcher(html);
                int insertion = head.find() ? head.end() : 0;
                bytes = (html.substring(0, insertion) + ERROR_PANEL + html.substring(insertion)).getBytes(StandardCharsets.UTF_8);
            }
            reply(output, "200 OK", "Content-Type: " + asset.type() + "\r\n", bytes);
        } catch (IOException | IllegalArgumentException ignored) {
            // A malformed request or closed browser socket cannot affect project data.
        } finally {
            clients.remove(client);
        }
    }

    private static void reply(OutputStream output, String status, String extra, byte[] bytes) throws IOException {
        output.write(("HTTP/1.1 " + status + "\r\nConnection: close\r\nCache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n" +
            "Cross-Origin-Resource-Policy: same-origin\r\nContent-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\r\n" +
            extra + "Content-Length: " + bytes.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        output.write(bytes);
    }

    @Override public void close() {
        try { server.close(); } catch (IOException ignored) {}
        for (Socket client : clients) {
            try { client.close(); } catch (IOException ignored) {}
        }
        requests.shutdown();
    }
}
