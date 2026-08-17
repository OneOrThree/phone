// SpikeView.swift
// GromoWatch — GROMO-1596 wake SLO 스파이크
//
// 사용법: 폰 앱을 원하는 상태(포그라운드 / 백그라운드 방치 / 강제종료)로 만든 뒤
// 「측정」을 탭한다. 행마다 다음이 찍힌다:
//   RTT      워치 발신 → 폰 응답 수신까지 왕복(ms)
//   wake     폰 프로세스 기동 → 메시지 수신까지(ms) — 콜드 스타트면 크고, 떠 있었으면 0에 가깝다
//   js       메시지 수신 시점에 RN JS 번들 로드가 끝나 있었는가 (+ 기동→로드 ms)
//   상태     폰이 응답 시점에 스스로 보고한 앱 상태 (fg/bg/inactive)
// 실패(미도달·타임아웃)는 빨간 행 — 이 비율 자체가 측정 목적의 절반이다(D7 근거).

import SwiftUI
import WatchConnectivity

struct SpikeEntry: Identifiable {
    let id = UUID()
    let label: String
    let detail: String
    let failed: Bool
    let at: Date
}

final class SpikeModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var entries: [SpikeEntry] = []
    @Published var activation = "대기"
    @Published var reachable = false

    override init() {
        super.init()
        guard WCSession.isSupported() else {
            activation = "미지원"
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func measure() {
        let session = WCSession.default
        guard session.activationState == .activated else {
            append("활성화 전", detail: "activation=\(activation)", failed: true)
            return
        }
        let t0 = Date()
        let wasReachable = session.isReachable
        session.sendMessage(["spike": "ping", "t0": t0.timeIntervalSince1970 * 1000]) { reply in
            let rtt = Int(Date().timeIntervalSince(t0) * 1000)
            let wake = (reply["wakeToReceiveMs"] as? Int).map(String.init) ?? "?"
            let jsLoaded = (reply["jsLoaded"] as? Bool) == true
            let jsMs = (reply["jsLoadMs"] as? Int).map(String.init) ?? "-"
            let appState = (reply["appState"] as? String) ?? "?"
            self.append(
                "RTT \(rtt)ms",
                detail: "wake \(wake)ms · js \(jsLoaded ? "적재됨(\(jsMs)ms)" : "미적재") · 폰 \(appState) · 발신시 도달=\(wasReachable ? "O" : "X")",
                failed: false
            )
        } errorHandler: { error in
            let rtt = Int(Date().timeIntervalSince(t0) * 1000)
            self.append(
                "실패 \(rtt)ms",
                detail: "\((error as NSError).code): \(error.localizedDescription) · 발신시 도달=\(wasReachable ? "O" : "X")",
                failed: true
            )
        }
    }

    private func append(_ label: String, detail: String, failed: Bool) {
        DispatchQueue.main.async {
            self.entries.insert(
                SpikeEntry(label: label, detail: detail, failed: failed, at: Date()), at: 0)
        }
    }

    // ── WCSessionDelegate ──
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            self.activation = error.map { "실패: \($0.localizedDescription)" }
                ?? (activationState == .activated ? "활성" : "비활성")
            self.reachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.reachable = session.isReachable }
    }
}

struct SpikeView: View {
    @StateObject private var model = SpikeModel()
    private static let timeFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    var body: some View {
        List {
            Section {
                Button(action: { model.measure() }) {
                    Text("측정")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                HStack {
                    Text("세션 \(model.activation)")
                    Spacer()
                    Text(model.reachable ? "도달 O" : "도달 X")
                        .foregroundStyle(model.reachable ? .green : .orange)
                }
                .font(.caption2)
            }
            Section("기록 (최신 위)") {
                ForEach(model.entries) { e in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(e.label)
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundStyle(e.failed ? .red : .primary)
                            Spacer()
                            Text(Self.timeFormat.string(from: e.at))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text(e.detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if !model.entries.isEmpty {
                    Button("기록 지우기", role: .destructive) { model.entries.removeAll() }
                        .font(.caption2)
                }
            }
        }
        .navigationTitle("wake 스파이크")
    }
}
