package com.chengyang.codetutor.workspace;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class Terminal {
    private static final Set<String> SIMPLE = Set.of("pwd", "ls", "date", "id", "uname", "df", "tty", "cat", "wc", "sort");
    private static final String INTERPRETERS = "(?i)(?:node|npm|npx|pnpm|yarn|bun|deno|python3?|pip3?|dart|flutter|java|javac|gradle|gradlew|git|make)(?:\\s.*)?";
    private final ScheduledExecutorService timeout = Executors.newSingleThreadScheduledExecutor();
    private final File directory;
    private Session running;
    private int rows = 12;
    private int columns = 80;

    private record Session(String id, int fd, int pid) {}

    static { System.loadLibrary("tutor_pty"); }

    Terminal(File cache) { directory = new File(cache, "terminal"); }

    String cwd() { return directory.getAbsolutePath(); }

    private String[] arguments(String input) throws IOException {
        if (input.length() > 512) throw new IOException("命令过长");
        String command = input.trim();
        if (SIMPLE.contains(command)) return new String[] {command};
        if (command.matches("sleep (?:[1-9]|[12][0-9]|30)")) return command.split(" ");
        if (command.matches("(?:mkdir|touch) [a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}")) {
            String[] args = command.split(" ");
            File target = new File(directory, args[1]);
            if (!target.getCanonicalFile().equals(target.getAbsoluteFile()) || target.exists()) {
                throw new IOException("请选择沙箱中尚未存在的名称");
            }
            return args;
        }
        if (command.matches(INTERPRETERS)) {
            throw new IOException("应用内未安装此运行环境。Node.js、npm、npx 可在用户自己配置的 Termux 或开发主机中执行");
        }
        throw new IOException("命令或参数未开放。支持 pwd、ls、date、id、uname、df、tty、cat、wc、sort、sleep 1–30、mkdir 名称、touch 名称");
    }

    synchronized void start(String id, String input, boolean confirmed, Consumer<Map<String, Object>> event) throws IOException {
        if (!confirmed) throw new IOException("运行命令需要确认");
        if (running != null) throw new IOException("已有进程运行，请先停止");
        if (timeout.isShutdown()) throw new IOException("终端已关闭");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法建立终端沙箱");
        int[] handles = launch(cwd(), arguments(input), rows, columns);
        Session session = new Session(id, handles[0], handles[1]);
        running = session;
        var deadline = timeout.schedule(() -> stop(id), input.trim().startsWith("sleep ") ? 35 : 120, TimeUnit.SECONDS);
        new Thread(() -> {
            try (var reader = new InputStreamReader(new PtyOutput(session.fd()), StandardCharsets.UTF_8)) {
                char[] buffer = new char[2048];
                int count;
                while ((count = reader.read(buffer)) >= 0) {
                    event.accept(Map.of("id", id, "kind", "output", "text", new String(buffer, 0, count)));
                }
            } catch (IOException failure) {
                stop(id);
                event.accept(Map.of("id", id, "kind", "output", "text", "\n" + failure.getMessage() + "\n"));
            } finally {
                int code = finish(session);
                deadline.cancel(false);
                event.accept(Map.of("id", id, "kind", "exit", "code", code));
            }
        }, "code-tutor-pty").start();
    }

    private int finish(Session session) {
        while (true) {
            synchronized (this) {
                int code = reapPty(session.pid());
                if (code >= 0) {
                    closePty(session.fd());
                    running = null;
                    return code;
                }
            }
            android.os.SystemClock.sleep(25);
        }
    }

    synchronized void send(String id, String text) throws IOException {
        if (running == null || !running.id().equals(id)) throw new IOException("该终端进程已结束");
        writePty(running.fd(), text.getBytes(StandardCharsets.UTF_8));
    }

    synchronized void resize(int nextRows, int nextColumns) {
        rows = Math.max(2, Math.min(200, nextRows));
        columns = Math.max(10, Math.min(300, nextColumns));
        if (running != null) resizePty(running.fd(), rows, columns);
    }

    synchronized void stop(String id) {
        if (running != null && running.id().equals(id)) killPty(running.pid());
    }

    synchronized void close() {
        if (running != null) stop(running.id());
        timeout.shutdownNow();
    }

    private static class PtyOutput extends InputStream {
        private final int fd;

        PtyOutput(int fd) { this.fd = fd; }

        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            int count;
            do { count = readPty(fd, buffer, offset, length); } while (count == -2);
            return count;
        }

        @Override public int read() throws IOException {
            byte[] buffer = new byte[1];
            return read(buffer, 0, 1) == -1 ? -1 : buffer[0] & 255;
        }
    }

    private static native int[] launch(String directory, String[] arguments, int rows, int columns) throws IOException;
    private static native int readPty(int fd, byte[] buffer, int offset, int length) throws IOException;
    private static native void writePty(int fd, byte[] data) throws IOException;
    private static native void resizePty(int fd, int rows, int columns);
    private static native void killPty(int pid);
    private static native int reapPty(int pid);
    private static native void closePty(int fd);
}
