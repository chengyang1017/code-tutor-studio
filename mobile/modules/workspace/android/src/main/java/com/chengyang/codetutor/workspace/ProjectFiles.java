package com.chengyang.codetutor.workspace;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class ProjectFiles {
    static final int LIMIT = 512 * 1024;
    private static final String DIR = Document.MIME_TYPE_DIR;
    private static final Set<String> IGNORE = Set.of(".git", "node_modules", ".gradle", ".dart_tool", ".expo", "build");
    private static final String[] COLUMNS = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE };

    private final ContentResolver resolver;
    private final SharedPreferences prefs;
    private Uri tree;
    private Entry root;

    private record Entry(String id, String name, String mime) {
        boolean directory() { return DIR.equals(mime); }
    }

    private record Encoding(Charset charset, int bomSize) {}
    record PreviewRoot(Uri tree, String id, String key) {}

    ProjectFiles(Context context) {
        resolver = context.getContentResolver();
        prefs = context.getSharedPreferences("code_tutor_workspace", Context.MODE_PRIVATE);
    }

    static String hash(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(Character.forDigit(b >>> 4 & 15, 16)).append(Character.forDigit(b & 15, 16));
        return hex.toString();
    }

    private static String name(String value) throws IOException {
        if (value == null || value.trim().isEmpty() || value.length() > 255 || value.equals(".") || value.equals("..")
            || value.indexOf('/') >= 0 || value.indexOf('\\') >= 0 || value.indexOf(':') >= 0
            || value.chars().anyMatch(c -> c < 32 || c == 127)) throw new IOException("无效的项目文件名称");
        return value;
    }

    private Uri document(Uri scope, String id) {
        return DocumentsContract.buildDocumentUriUsingTree(scope, id);
    }

    private Entry entry(Uri uri) throws IOException {
        try (Cursor cursor = resolver.query(uri, COLUMNS, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new IOException("文档不存在或权限已撤销");
            return new Entry(cursor.getString(0), cursor.getString(1), cursor.getString(2));
        }
    }

    private List<Entry> children(Uri scope, String parent) throws IOException {
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(scope, parent);
        List<Entry> entries = new ArrayList<>();
        try (Cursor cursor = resolver.query(uri, COLUMNS, null, null, null)) {
            if (cursor == null) throw new IOException("无法读取目录或权限已撤销");
            while (cursor.moveToNext()) {
                if (entries.size() >= 5000) throw new IOException("目录超过 5000 个条目");
                entries.add(new Entry(cursor.getString(0), cursor.getString(1), cursor.getString(2)));
            }
        }
        return entries;
    }

    private Entry find(Uri scope, Entry parent, String part) throws IOException {
        if (!parent.directory()) throw new IOException("目标父项不是目录");
        Entry found = null;
        for (Entry child : children(scope, parent.id())) {
            if (!part.equals(child.name())) continue;
            if (found != null) throw new IOException("此目录含有同名文档，请在系统文件管理器中处理");
            found = child;
        }
        return found;
    }

    private Entry resolve(Uri scope, Entry start, String path) throws IOException {
        if (path.isEmpty()) return start;
        if (path.length() > 1024) throw new IOException("项目路径过长");
        Entry current = start;
        for (String part : path.split("/", -1)) {
            current = find(scope, current, name(part));
            if (current == null) throw new IOException("找不到项目文档：" + path);
        }
        return current;
    }

    private void check(String key) throws Exception {
        if (tree == null || root == null || !key.equals(key())) throw new IOException("项目已切换，请重新打开文件");
    }

    private String key() throws Exception {
        return hash((tree + "\n" + root.id()).getBytes(StandardCharsets.UTF_8));
    }

    private Map<String, Object> project() throws Exception {
        return Map.of("id", key(), "name", root.name());
    }

    synchronized Map<String, Object> open(Uri selected, String newName) throws Exception {
        if (!"content".equals(selected.getScheme()) || !DocumentsContract.isTreeUri(selected)) {
            throw new IOException("请选择 Android 文档目录");
        }
        Entry next = entry(document(selected, DocumentsContract.getTreeDocumentId(selected)));
        if (!next.directory()) throw new IOException("授权文档不是目录");
        if (newName != null) next = createEntry(selected, next, name(newName), true);
        Uri previous = tree;
        tree = selected;
        root = next;
        prefs.edit().putString("tree", tree.toString()).putString("root", root.id()).apply();
        if (previous != null && !previous.equals(selected)) {
            for (var grant : resolver.getPersistedUriPermissions()) {
                if (!previous.equals(grant.getUri())) continue;
                int flags = (grant.isReadPermission() ? 1 : 0) | (grant.isWritePermission() ? 2 : 0);
                try { resolver.releasePersistableUriPermission(previous, flags); } catch (SecurityException ignored) {}
            }
        }
        return project();
    }

    synchronized Map<String, Object> restore() throws Exception {
        String stored = prefs.getString("tree", null);
        String id = prefs.getString("root", null);
        if (stored == null || id == null) return null;
        Uri candidate = Uri.parse(stored);
        boolean allowed = resolver.getPersistedUriPermissions().stream().anyMatch(grant ->
            candidate.equals(grant.getUri()) && grant.isReadPermission() && grant.isWritePermission());
        if (!allowed) throw new IOException("上次的项目目录授权已失效，请重新选择目录");
        Entry next = entry(document(candidate, id));
        if (!next.directory()) throw new IOException("上次的项目目录不可用");
        tree = candidate;
        root = next;
        return project();
    }

    synchronized List<Map<String, Object>> list(String key, String path) throws Exception {
        check(key);
        Entry parent = resolve(tree, root, path);
        if (!parent.directory()) throw new IOException("目标不是目录");
        List<Entry> entries = children(tree, parent.id());
        Map<String, Integer> counts = new HashMap<>();
        for (Entry child : entries) counts.merge(child.name(), 1, Integer::sum);
        entries.sort(Comparator.comparing(Entry::directory).reversed().thenComparing(Entry::name, String.CASE_INSENSITIVE_ORDER));
        List<Map<String, Object>> result = new ArrayList<>();
        for (Entry child : entries) {
            try { name(child.name()); } catch (IOException skipped) { continue; }
            if (counts.get(child.name()) > 1 || (child.directory() && IGNORE.contains(child.name()))) continue;
            String relative = path.isEmpty() ? child.name() : path + "/" + child.name();
            if (relative.length() <= 1024) result.add(Map.of("path", relative, "directory", child.directory()));
        }
        return result;
    }

    private Entry createEntry(Uri scope, Entry parent, String child, boolean directory) throws IOException {
        if (find(scope, parent, child) != null) throw new IOException("已存在同名文档");
        String mime = directory ? DIR : "application/octet-stream";
        Uri created = DocumentsContract.createDocument(resolver, document(scope, parent.id()), mime, child);
        if (created == null) throw new IOException("存储提供程序拒绝创建文档");
        return entry(created);
    }

    synchronized String create(String key, String parent, String child, boolean directory) throws Exception {
        check(key);
        Entry result = createEntry(tree, resolve(tree, root, parent), name(child), directory);
        return parent.isEmpty() ? result.name() : parent + "/" + result.name();
    }

    synchronized void rename(String key, String path, String next) throws Exception {
        check(key);
        if (path.isEmpty()) throw new IOException("无法重命名项目根目录");
        Entry item = resolve(tree, root, path);
        name(next);
        int slash = path.lastIndexOf('/');
        Entry parent = resolve(tree, root, slash < 0 ? "" : path.substring(0, slash));
        if (find(tree, parent, next) != null) throw new IOException("已存在同名文档");
        if (DocumentsContract.renameDocument(resolver, document(tree, item.id()), next) == null) {
            throw new IOException("存储提供程序拒绝重命名");
        }
    }

    synchronized void delete(String key, String path, boolean confirmed) throws Exception {
        check(key);
        if (path.isEmpty() || !confirmed) throw new IOException("删除需要明确确认");
        Entry item = resolve(tree, root, path);
        if (!DocumentsContract.deleteDocument(resolver, document(tree, item.id()))) throw new IOException("存储提供程序拒绝删除");
    }

    private byte[] bytes(Uri uri, int limit) throws IOException {
        try (InputStream input = resolver.openInputStream(uri); ByteArrayOutputStream data = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("无法读取文件");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (data.size() + count > limit) throw new IOException("文件超过可读取大小限制");
                data.write(buffer, 0, count);
            }
            return data.toByteArray();
        }
    }

    private static Encoding encoding(byte[] bytes) {
        if (bytes.length >= 3 && bytes[0] == (byte) 0xef && bytes[1] == (byte) 0xbb && bytes[2] == (byte) 0xbf) {
            return new Encoding(StandardCharsets.UTF_8, 3);
        }
        if (bytes.length >= 2 && bytes[0] == (byte) 0xff && bytes[1] == (byte) 0xfe) return new Encoding(StandardCharsets.UTF_16LE, 2);
        if (bytes.length >= 2 && bytes[0] == (byte) 0xfe && bytes[1] == (byte) 0xff) return new Encoding(StandardCharsets.UTF_16BE, 2);
        return new Encoding(StandardCharsets.UTF_8, 0);
    }

    private static String decode(byte[] bytes, Encoding format) throws IOException {
        String text;
        try {
            text = format.charset().newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, format.bomSize(), bytes.length - format.bomSize())).toString();
        } catch (java.nio.charset.CharacterCodingException error) {
            throw new IOException("二进制或未知编码文件：支持 UTF-8 和带 BOM 的 UTF-16");
        }
        if (text.chars().anyMatch(c -> c < 32 && c != '\t' && c != '\r' && c != '\n')) {
            throw new IOException("二进制文件或含非文本控制字符");
        }
        return text;
    }

    private static boolean editable(String path) {
        return path.toLowerCase(Locale.ROOT).matches(".*\\.(?:[cm]?[jt]sx?|jsonc?|html?|css|scss|less|py|dart|md|txt|svg|xml|yaml|yml|toml|ini|properties|gradle|java|kt|kts|c|h|cpp|rs|go|sql|sh|rb|php|vue|svelte|env|lock|gitignore|npmrc|editorconfig)$")
            || path.matches("(?i)(?:.*/)?(?:\\.env(?:\\..+)?|README|LICENSE|Dockerfile|Makefile)");
    }

    synchronized Map<String, Object> read(String key, String path) throws Exception {
        check(key);
        Entry item = resolve(tree, root, path);
        if (item.directory() || !editable(path)) throw new IOException("此类文件不进入文本编辑器");
        byte[] data = bytes(document(tree, item.id()), LIMIT);
        String text = decode(data, encoding(data));
        String withoutPairs = text.replace("\r\n", "");
        int lineEndings = (text.contains("\r\n") ? 1 : 0) + (withoutPairs.contains("\r") ? 1 : 0) + (withoutPairs.contains("\n") ? 1 : 0);
        return Map.of("text", text.replace("\r\n", "\n").replace('\r', '\n'), "revision", hash(data),
            "readOnly", lineEndings > 1);
    }

    private void writeBytes(Uri uri, byte[] content) throws IOException {
        try (OutputStream stream = resolver.openOutputStream(uri, "wt")) {
            if (stream == null) throw new IOException("无法写入文件");
            stream.write(content);
        }
    }

    synchronized String write(String key, String path, String revision, String text) throws Exception {
        check(key);
        if (text.length() > LIMIT || !editable(path) || text.chars().anyMatch(c -> c < 32 && c != '\t' && c != '\r' && c != '\n')) {
            throw new IOException("超出可编辑文本限制");
        }
        Entry item = resolve(tree, root, path);
        if (item.directory()) throw new IOException("目标不是文件");
        Uri uri = document(tree, item.id());
        byte[] prior = bytes(uri, LIMIT);
        if (!revision.equals(hash(prior))) throw new IOException("文件冲突：磁盘内容已变化，未覆盖");
        Encoding format = encoding(prior);
        String original = decode(prior, format);
        String withoutPairs = original.replace("\r\n", "");
        if ((original.contains("\r\n") ? 1 : 0) + (withoutPairs.contains("\r") ? 1 : 0) + (withoutPairs.contains("\n") ? 1 : 0) > 1) {
            throw new IOException("混合换行文件为只读");
        }
        String newline = original.contains("\r\n") ? "\r\n" : original.contains("\r") ? "\r" : "\n";
        ByteBuffer body = format.charset().newEncoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(text.replace("\n", newline)));
        if (format.bomSize() + body.remaining() > LIMIT) throw new IOException("编码后超过 512 KiB");
        byte[] data = Arrays.copyOf(prior, format.bomSize() + body.remaining());
        body.get(data, format.bomSize(), body.remaining());
        if (Arrays.equals(prior, data)) return revision;
        if (!Arrays.equals(prior, bytes(uri, LIMIT))) throw new IOException("文件冲突：写入前磁盘内容已变化");
        writeBytes(uri, data);
        if (!Arrays.equals(data, bytes(uri, LIMIT))) throw new IOException("存储提供程序未能完整写入，请检查磁盘文件");
        return hash(data);
    }

    synchronized PreviewRoot previewRoot(String key) throws Exception {
        check(key);
        Entry dist = find(tree, root, "dist");
        if (dist != null && dist.directory()) {
            Entry index = find(tree, dist, "index.html");
            if (index != null && !index.directory()) return new PreviewRoot(tree, dist.id(), key);
        }
        if (find(tree, root, "package.json") != null) {
            throw new IOException("此项目需要 Node.js 构建。请在电脑或受信任的远程环境运行 npm ci 和 npm run build，再同步 dist/。React Native 项目需要 Metro 与对应的开发构建。");
        }
        Entry index = find(tree, root, "index.html");
        if (index == null || index.directory()) throw new IOException("找不到 index.html 或 dist/index.html");
        return new PreviewRoot(tree, root.id(), key);
    }

    synchronized byte[] previewFile(PreviewRoot preview, String path) throws Exception {
        check(preview.key());
        Entry item = resolve(preview.tree(), new Entry(preview.id(), "", DIR), path);
        if (item.directory()) throw new IOException("不能列出目录");
        return bytes(document(preview.tree(), item.id()), 8 * 1024 * 1024);
    }

    String getPreferences() {
        return prefs.getString("preferences", null);
    }

    void putPreferences(String data) throws IOException {
        if (data.length() > 2000) throw new IOException("设置数据过大");
        prefs.edit().putString("preferences", data).apply();
    }

    synchronized String getState(String key) throws Exception {
        check(key);
        return prefs.getString("state:" + key, null);
    }

    synchronized void putState(String key, String data) throws Exception {
        check(key);
        if (data.length() > 32000) throw new IOException("项目进度数据过大");
        prefs.edit().putString("state:" + key, data).apply();
    }
}
