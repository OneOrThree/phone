//
//  screentimereport.swift
//  screentimereport
//
//  Created by 안수빈 on 6/8/26.
//

import DeviceActivity
import ExtensionKit
import SwiftUI

@main
struct screentimereport: DeviceActivityReportExtension {
    var body: some DeviceActivityReportScene {
        // Create a report for each DeviceActivityReport.Context that your app supports.
        TotalActivityReport { totalActivity in
            TotalActivityView(totalActivity: totalActivity)
        }
        // HomeScreen "사용" StatBox용 컴팩트 리포트 (총 사용 시간 숫자만)
        CompactActivityReport { totalActivity in
            CompactActivityView(totalActivity: totalActivity)
        }
        // HomeScreen "남은" StatBox용 리포트 (목표 - 사용 = 남은)
        RemainingActivityReport { totalActivity in
            RemainingActivityView(totalActivity: totalActivity)
        }
        // v2 홈 "핸드폰 사용" 리포트 (총 사용시간 + 목표 대비 진행 바)
        HomeUsageReport { totalActivity in
            HomeUsageView(totalActivity: totalActivity)
        }
    }
}
