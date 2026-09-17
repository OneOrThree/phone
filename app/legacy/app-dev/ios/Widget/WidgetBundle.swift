//
//  WidgetBundle.swift
//  Widget
//
//  Created by Taehwa Kown on 6/27/26.
//

import WidgetKit
import SwiftUI

// 번들엔 Live Activity만 등록 — GromoWidget/WidgetControl은 Xcode 템플릿(미사용).
// WidgetControl은 iOS 18+ 전용이라 배포 타깃(17.0)에선 등록 불가이기도 함.
@main
struct GromoWidgetBundle: WidgetBundle {
    var body: some Widget {
        WidgetLiveActivity()
    }
}
