"""기기/JNI 없이 수정된 C++ 어댑터를 직접 실행한다.

플랫폼 인터페이스만 대체한다. 캡처 해제 순서·스레드를 검증하며,
Hermes 메모리 안전성이나 실제 기기의 크래시 해소를 증명하지는 않는다.
"""

import os
from pathlib import Path
import subprocess
import tempfile

APP = Path(__file__).resolve().parents[2]
HEADERS = APP / "node_modules/react-native-vision-camera-worklets/cpp"
STUBS = {
    "jsi/jsi.h": "#pragma once\n",
    "NitroModules/JSIConverter.hpp": "#pragma once\n",
    "worklets/RunLoop/AsyncQueue.h": """#pragma once
#include <functional>
namespace worklets {
class AsyncQueue { public: virtual ~AsyncQueue() = default;
virtual void push(std::function<void()>&&) = 0; };
}
""",
    "VisionCamera/HybridNativeThreadSpec.hpp": """#pragma once
#include <functional>
#include <memory>
#include <stdexcept>
namespace margelo::nitro {
class Dispatcher { public: virtual ~Dispatcher() = default;
virtual void runSync(std::function<void()>&&) = 0;
virtual void runAsync(std::function<void()>&&) = 0; };
namespace camera {
class HybridNativeThreadSpec { public: virtual ~HybridNativeThreadSpec() = default;
virtual void runOnThread(const std::function<void()>&) = 0; };
}}
""",
}

with tempfile.TemporaryDirectory(prefix="camera-queue-test-") as directory:
    root = Path(directory)
    for name, content in STUBS.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    binary = root / "test-queue"
    subprocess.run(
        [os.environ.get("CXX", "c++"), "-std=c++20", "-Wall", "-Wextra", "-Werror",
         "-fsanitize=address,undefined", "-pthread", "-I", str(root), "-I", str(HEADERS),
         str(Path(__file__).with_name("camera-queue-lifetime.cpp")), "-o", str(binary)],
        check=True,
    )
    subprocess.run([str(binary)], check=True)
