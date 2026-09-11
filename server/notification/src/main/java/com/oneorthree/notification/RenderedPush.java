package com.oneorthree.notification;

import java.util.Map;

record RenderedPush(String title, String body, Map<String, String> data, boolean silent) { }
