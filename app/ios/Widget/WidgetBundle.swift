//
//  WidgetBundle.swift
//  Widget
//
//  Created by Taehwa Kown on 6/27/26.
//

import WidgetKit
import SwiftUI

@main
struct GromoWidgetBundle: WidgetBundle {
    var body: some Widget {
        GromoWidget()
        WidgetControl()
        WidgetLiveActivity()
    }
}
