// 설치된 VisionCameraWorklets 헤더를 직접 컴파일한다. 플랫폼 대역은 Android의
// JFunc_void_cxx처럼 Java GC가 돌 때까지 콜백 사본을 보관한다.
#include "NativeThreadAsyncQueue.hpp"
#include "NativeThreadDispatcher.hpp"
#include <iostream>
#include <thread>
#include <vector>

using namespace margelo::nitro::camera;

class RetainingThread final : public HybridNativeThreadSpec {
public:
  std::vector<std::function<void()>> callbacks;
  void runOnThread(const std::function<void()>& task) override {
    callbacks.push_back(task);
    callbacks.push_back(task); // 네이티브/Java 경계에서 콜백이 복사될 수 있다.
  }
};

struct Capture {
  std::thread::id& destroyedOn;
  explicit Capture(std::thread::id& thread) : destroyedOn(thread) {}
  ~Capture() { destroyedOn = std::this_thread::get_id(); }
};

bool check(bool dispatcher, bool throws) {
  auto thread = std::make_shared<RetainingThread>();
  std::thread::id destroyedOn;
  std::thread::id ranOn;
  int calls = 0;
  auto capture = std::make_shared<Capture>(destroyedOn);
  std::weak_ptr<Capture> weak = capture;
  std::function<void()> job = [capture, &calls, throws] {
    ++calls;
    if (throws) throw std::runtime_error("inference failed");
  };
  capture.reset();
  if (dispatcher) {
    margelo::nitro::camera::worklets::NativeThreadDispatcher queue(thread);
    queue.runAsync(std::move(job));
  } else {
    margelo::nitro::camera::worklets::NativeThreadAsyncQueue queue(thread);
    queue.push(std::move(job));
  }
  // 이동한 작업의 원래 변수에도 캡처가 남지 않아야 한다.
  bool transferred = !job;
  job = {};
  std::thread executor([&] {
    ranOn = std::this_thread::get_id();
    try { thread->callbacks.front()(); } catch (const std::runtime_error&) {}
  });
  executor.join();
  bool releasedBeforeGC = weak.expired();
  bool releasedOnExecutor = destroyedOn == ranOn;
  thread->callbacks.clear(); // 다른 스레드에서 Java finalizer 실행을 모사한다.
  bool pass = transferred && releasedBeforeGC && releasedOnExecutor && calls == 1;
  std::cout << (dispatcher ? "dispatcher" : "queue") << (throws ? " exception" : " success")
            << ": " << (pass ? "PASS" : "FAIL")
            << " (moved=" << transferred << ", released-before-GC=" << releasedBeforeGC
            << ", executor-destruction=" << releasedOnExecutor << ")\n";
  return pass;
}

int main() {
  bool pass = true;
  for (bool dispatcher : {false, true})
    for (bool throws : {false, true}) pass = check(dispatcher, throws) && pass;
  return pass ? 0 : 1;
}
