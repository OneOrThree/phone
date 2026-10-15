package com.oneorthree.notification;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** 사건에 보존한 목표를 실제 선택된 템플릿의 언어로 렌더한다. 코어 DB 조회는 하지 않는다. */
final class ChallengeMissionRenderer {
    private static final List<String> DAYS = List.of("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN");

    private ChallengeMissionRenderer() {
    }

    static String render(Map<String, Object> mission, String locale) {
        boolean screen = "SCREEN_TIME".equals(mission.get("category"));
        String what = switch (locale) {
            case "en" -> screen ? "screen time" : "focus";
            case "ja" -> screen ? "スクリーンタイム" : "集中";
            case "zh-Hant" -> screen ? "螢幕使用時間" : "專注";
            default -> screen ? "스크린타임" : "집중";
        };
        String fallback = screen ? what : switch (locale) {
            case "en" -> "focus time";
            case "ja" -> "集中時間";
            case "zh-Hant" -> "專注時間";
            default -> "집중 시간";
        };
        Object minutes = mission.get("durationMinutes");
        String goal = minutes == null ? what : switch (locale) {
            case "en" -> minutes + " min " + what;
            case "ja" -> minutes + "分の" + what;
            case "zh-Hant" -> minutes + "分鐘" + what;
            default -> minutes + "분 " + what;
        };
        if ("DURATION".equals(mission.get("type"))) {
            if (minutes == null) {
                return fallback;
            }
            return switch (locale) {
                case "en" -> goal + " per day";
                case "ja" -> "毎日" + goal;
                case "zh-Hant" -> "每天" + goal;
                default -> "하루 " + goal;
            };
        }
        if (mission.get("windowStart") == null || mission.get("windowEnd") == null) {
            return fallback;
        }
        return repeat(mission.get("repeatDays"), locale) + " " + mission.get("windowStart")
                + "~" + mission.get("windowEnd") + " " + goal;
    }

    private static String repeat(Object raw, String locale) {
        List<?> days = raw instanceof List<?> values ? values : List.of();
        if (days.containsAll(DAYS)) {
            return switch (locale) {
                case "en" -> "Every day";
                case "ja" -> "毎日";
                case "zh-Hant" -> "每天";
                default -> "매일";
            };
        }
        List<String> names = switch (locale) {
            case "en" -> List.of("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun");
            case "ja" -> List.of("月", "火", "水", "木", "金", "土", "日");
            case "zh-Hant" -> List.of("週一", "週二", "週三", "週四", "週五", "週六", "週日");
            default -> List.of("월", "화", "수", "목", "금", "토", "일");
        };
        return DAYS.stream().filter(days::contains).map(day -> names.get(DAYS.indexOf(day)))
                .collect(Collectors.joining("·"));
    }
}
