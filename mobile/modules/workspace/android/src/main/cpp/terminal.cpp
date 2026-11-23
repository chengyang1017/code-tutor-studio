#include <jni.h>
#include <cerrno>
#include <csignal>
#include <fcntl.h>
#include <poll.h>
#include <pty.h>
#include <string>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

namespace {
void fail(JNIEnv *env, const char *message) {
    env->ThrowNew(env->FindClass("java/io/IOException"), message);
}

std::string stringFromJni(JNIEnv *env, jstring value) {
    const char *raw = env->GetStringUTFChars(value, nullptr);
    if (!raw) return {};
    std::string text(raw);
    env->ReleaseStringUTFChars(value, raw);
    return text;
}

winsize dimensions(jint rows, jint columns) {
    return {static_cast<unsigned short>(rows), static_cast<unsigned short>(columns), 0, 0};
}
}

#define BRIDGE(name) Java_com_chengyang_codetutor_workspace_Terminal_##name

extern "C" JNIEXPORT jintArray JNICALL BRIDGE(launch)(
    JNIEnv *env, jclass, jstring directory, jobjectArray arguments, jint rows, jint columns) {
    const auto cwd = stringFromJni(env, directory);
    std::vector<std::string> storage{"/system/bin/toybox"};
    for (jsize index = 0; index < env->GetArrayLength(arguments); ++index) {
        auto argument = static_cast<jstring>(env->GetObjectArrayElement(arguments, index));
        storage.push_back(stringFromJni(env, argument));
        env->DeleteLocalRef(argument);
    }
    if (env->ExceptionCheck()) return nullptr;
    jintArray result = env->NewIntArray(2);
    if (!result) return nullptr;
    std::vector<char *> argv;
    for (auto &argument : storage) argv.push_back(argument.data());
    argv.push_back(nullptr);
    char path[] = "PATH=/system/bin";
    char terminal[] = "TERM=dumb";
    std::string home = "HOME=" + cwd;
    char *environment[]{path, terminal, home.data(), nullptr};
    auto size = dimensions(rows, columns);
    const long maxFd = sysconf(_SC_OPEN_MAX);
    int fd = -1;
    pid_t pid = forkpty(&fd, nullptr, nullptr, &size);
    if (pid == 0) {
        // The Android VM is multithreaded. Only async-signal-safe calls before exec.
#ifdef __NR_close_range
        if (syscall(__NR_close_range, 3u, ~0u, 0u) != 0)
#endif
            for (int inherited = 3; inherited < maxFd; ++inherited) syscall(SYS_close, inherited);
        if (chdir(cwd.c_str()) == 0) execve(argv[0], argv.data(), environment);
        constexpr char failure[] = "Android could not start the Toybox command.\n";
        write(STDERR_FILENO, failure, sizeof(failure) - 1);
        _exit(127);
    }
    if (pid < 0) {
        fail(env, "Android 无法建立 PTY");
        return nullptr;
    }
    if (fcntl(fd, F_SETFD, FD_CLOEXEC) < 0 || fcntl(fd, F_SETFL, O_NONBLOCK) < 0) {
        kill(pid, SIGKILL);
        close(fd);
        while (waitpid(pid, nullptr, 0) < 0 && errno == EINTR) {}
        fail(env, "无法配置 PTY 文件描述符");
        return nullptr;
    }
    jint handles[]{fd, pid};
    env->SetIntArrayRegion(result, 0, 2, handles);
    return result;
}

extern "C" JNIEXPORT jint JNICALL BRIDGE(readPty)(
    JNIEnv *env, jclass, jint fd, jbyteArray buffer, jint offset, jint length) {
    pollfd ready{fd, POLLIN, 0};
    int result = poll(&ready, 1, 150);
    if (result == 0 || (result < 0 && errno == EINTR)) return -2;
    if (result < 0) { fail(env, "PTY 等待输出失败"); return -1; }
    char bytes[4096];
    auto count = read(fd, bytes, length < 4096 ? length : 4096);
    if (count < 0 && (errno == EAGAIN || errno == EINTR)) return -2;
    if (count == 0 || (count < 0 && errno == EIO)) return -1;
    if (count < 0) { fail(env, "PTY 读取失败"); return -1; }
    env->SetByteArrayRegion(buffer, offset, count, reinterpret_cast<jbyte *>(bytes));
    return count;
}

extern "C" JNIEXPORT void JNICALL BRIDGE(writePty)(
    JNIEnv *env, jclass, jint fd, jbyteArray data) {
    char bytes[1024];
    const auto size = env->GetArrayLength(data);
    if (size > static_cast<jsize>(sizeof(bytes))) { fail(env, "标准输入过长"); return; }
    env->GetByteArrayRegion(data, 0, size, reinterpret_cast<jbyte *>(bytes));
    if (env->ExceptionCheck()) return;
    if (write(fd, bytes, size) != size) fail(env, "PTY 未能写入全部输入，请检查进程输出");
}

extern "C" JNIEXPORT void JNICALL BRIDGE(resizePty)(
    JNIEnv *, jclass, jint fd, jint rows, jint columns) {
    auto size = dimensions(rows, columns);
    ioctl(fd, TIOCSWINSZ, &size);
}

extern "C" JNIEXPORT void JNICALL BRIDGE(killPty)(JNIEnv *, jclass, jint pid) {
    kill(pid, SIGKILL);
}

extern "C" JNIEXPORT jint JNICALL BRIDGE(reapPty)(JNIEnv *, jclass, jint pid) {
    int status = 0;
    const auto result = waitpid(pid, &status, WNOHANG);
    if (result == 0 || (result < 0 && errno == EINTR)) return -1;
    if (result < 0) return 125;
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}

extern "C" JNIEXPORT void JNICALL BRIDGE(closePty)(JNIEnv *, jclass, jint fd) {
    close(fd);
}
