package com.chengyang.codetutor.workspace;

import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class Terminal {
    private static final Set<String> SIMPLE = Set.of("pwd", "ls", "date", "id", "uname", "df");
    private final ScheduledExecutorService timeout = Executors.newSingleThreadScheduledExecutor();
    private final File directory;
    private Process running;

    Terminal(File cache) { directory = new File(cache, "terminal"); }

    String cwd() { return directory.getAbsolutePath(); }

    synchronized void start(String id, String input, boolean confirmed, Consumer<Map<String, Object>> event) throws Exception {
        if (!confirmed) throw new IOException("运行命令需要确认");
        if (running != null) throw new IOException("已有进程运行，请先停止");
        String command = input.trim();
        List<String> argv;
        if (SIMPLE.contains(command)) argv = List.of("/system/bin/toybox", command);
        else if (command.matches("sleep (?:[1-9]|[12][0-9]|30)")) {
            argv = List.of("/system/bin/toybox", "sleep", command.substring(6));
        } else if (command.matches("(?is)(?:node|npm|npx|pnpm|yarn|bun|deno|python3?|pip3?|dart|flutter|java|javac|gradle|gradlew|git|make)(?:\\s.*)?")) {
            throw new IOException("缺少此命令的运行环境。请在电脑或受信任的开发主机执行构建");
        } else {
            throw new IOException("Android 终端未开放此命令或参数。支持 pwd、ls、date、id、uname、df、sleep 1–30；不解析 shell、管道或重定向");
        }
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法建立终端沙箱");
        ProcessBuilder builder = new ProcessBuilder(argv).directory(directory).redirectErrorStream(true);
        builder.environment().clear();
        builder.environment().put("PATH", "/system/bin");
        builder.environment().put("HOME", cwd());
        Process process = builder.start();
        running = process;
        try {
            process.getOutputStream().close();
        } catch (IOException failure) {
            process.destroyForcibly();
            running = null;
            throw failure;
        }
        var deadline = timeout.schedule(() -> process.destroyForcibly(), 35, TimeUnit.SECONDS);
        new Thread(() -> {
            try (var reader = new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8)) {
                char[] buffer = new char[4096];
                int count;
                while ((count = reader.read(buffer)) >= 0) {
                    event.accept(Map.of("id", id, "kind", "output", "text", new String(buffer, 0, count)));
                }
            } catch (IOException error) {
                event.accept(Map.of("id", id, "kind", "output", "text", "\n读取进程输出结束：" + error.getMessage() + "\n"));
            } finally {
                try {
                    int status = process.waitFor();
                    deadline.cancel(false);
                    synchronized (this) { if (running == process) running = null; }
                    event.accept(Map.of("id", id, "kind", "exit", "code", status));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        }, "code-tutor-terminal").start();
    }

    synchronized void stop() { if (running != null) running.destroyForcibly(); }
    synchronized void close() { stop(); timeout.shutdownNow(); }
}
