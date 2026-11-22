package com.chengyang.codetutor.workspace

import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.util.concurrent.Executors

class WorkspaceModule : Module() {
    private val context get() = requireNotNull(appContext.reactContext)
    private val project by lazy { ProjectFiles(context) }
    private val terminal by lazy { Terminal(context.cacheDir) }
    private val pickerWork = Executors.newSingleThreadExecutor()
    private var picker: Pair<Promise, String?>? = null
    private var preview: PreviewServer? = null

    private fun stopPreview() {
        synchronized(this) {
            preview?.close()
            preview = null
        }
    }

    override fun definition() = ModuleDefinition {
        Name("TutorWorkspace")
        Events("terminalEvent")

        AsyncFunction("pick") { name: String?, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null || picker != null) {
                promise.reject("PICKER_UNAVAILABLE", "目录选择器不可用或已打开", null)
                return@AsyncFunction
            }
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
            picker = promise to name
            try {
                activity.startActivityForResult(intent, 7914)
            } catch (failure: Exception) {
                picker = null
                promise.reject("PICKER_FAILED", failure.message, failure)
            }
        }.runOnQueue(Queues.MAIN)

        OnActivityResult { _, result ->
            if (result.requestCode != 7914) return@OnActivityResult
            val (promise, name) = picker ?: return@OnActivityResult
            picker = null
            val data = result.data
            val uri = data?.data
            if (result.resultCode != Activity.RESULT_OK || uri == null) {
                promise.resolve(null)
                return@OnActivityResult
            }
            val access = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            if (data.flags and access != access) {
                promise.reject("READ_ONLY_PROJECT", "所选目录未授予持久读写权限", null)
                return@OnActivityResult
            }
            pickerWork.execute {
                val resolver = context.contentResolver
                val alreadyGranted = resolver.persistedUriPermissions.any { it.uri == uri }
                try {
                    resolver.takePersistableUriPermission(uri, access)
                    val opened = project.open(uri, name)
                    stopPreview()
                    promise.resolve(opened)
                } catch (failure: Exception) {
                    if (!alreadyGranted) runCatching { resolver.releasePersistableUriPermission(uri, access) }
                    promise.reject("PROJECT_OPEN_FAILED", failure.message, failure)
                }
            }
        }

        AsyncFunction("restore") { project.restore() }
        AsyncFunction("list") { id: String, path: String -> project.list(id, path) }
        AsyncFunction("read") { id: String, path: String -> project.read(id, path) }
        AsyncFunction("write") { id: String, path: String, revision: String, text: String ->
            project.write(id, path, revision, text)
        }
        AsyncFunction("create") { id: String, parent: String, name: String, directory: Boolean ->
            project.create(id, parent, name, directory)
        }
        AsyncFunction("rename") { id: String, path: String, name: String -> project.rename(id, path, name) }
        AsyncFunction("delete") { id: String, path: String, confirmed: Boolean -> project.delete(id, path, confirmed) }
        AsyncFunction("getPreferences") { project.getPreferences() }
        AsyncFunction("putPreferences") { data: String -> project.putPreferences(data) }
        AsyncFunction("fingerprint") { text: String ->
            require(text.length <= ProjectFiles.LIMIT) { "教学文件过大" }
            ProjectFiles.hash(text.toByteArray(Charsets.UTF_8))
        }
        AsyncFunction("validateRemotePreview") { value: String ->
            val url = java.net.URI(value)
            require(url.scheme == "https" && url.host != null && url.userInfo == null &&
                url.port in -1..65535 && value.length <= 2048) { "仅支持无内嵌凭据的 HTTPS 地址" }
            url.toASCIIString()
        }
        AsyncFunction("getState") { id: String -> project.getState(id) }
        AsyncFunction("putState") { id: String, state: String -> project.putState(id, state) }
        AsyncFunction("terminalDirectory") { terminal.cwd() }
        AsyncFunction("run") { id: String, command: String, confirmed: Boolean ->
            terminal.start(id, command, confirmed) { payload ->
                sendEvent("terminalEvent", android.os.Bundle().apply {
                    putString("id", payload["id"] as String)
                    putString("kind", payload["kind"] as String)
                    (payload["text"] as? String)?.let { putString("text", it) }
                    (payload["code"] as? Int)?.let { putInt("code", it) }
                })
            }
        }
        AsyncFunction("stop") { terminal.stop() }
        AsyncFunction("preview") { id: String, confirmed: Boolean ->
            require(confirmed) { "浏览器执行项目代码前需要确认" }
            synchronized(this@WorkspaceModule) {
                stopPreview()
                PreviewServer(project, project.previewRoot(id)).also { preview = it }.url()
            }
        }
        AsyncFunction("stopPreview") { stopPreview() }

        OnDestroy {
            stopPreview()
            terminal.close()
            pickerWork.shutdownNow()
        }
    }
}
