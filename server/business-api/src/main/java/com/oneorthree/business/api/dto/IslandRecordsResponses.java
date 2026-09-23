package com.oneorthree.business.api.dto;

import com.oneorthree.business.upstream.data.dto.IslandFishEarnings;
import com.oneorthree.business.upstream.data.dto.IslandLedger;
import com.oneorthree.business.upstream.data.dto.IslandRankingViews;
import com.oneorthree.business.upstream.data.dto.IslandRecordViews;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 공개 필드만 명시적으로 조립한다. 내부 전송 DTO의 확장이 응답에 섞이지 않도록 분리한다. */
public final class IslandRecordsResponses {

    private IslandRecordsResponses() {
    }

    public record RecordDaySeconds(
            String date,
            long seconds) {
        public static RecordDaySeconds from(IslandRecordViews.DaySeconds value) {
            if (value == null) {
                return null;
            }
            return new RecordDaySeconds(
                    value.date(),
                    value.seconds());
        }
    }

    public record IslandFocusRecord(
            String id,
            String subject,
            long activeSeconds,
            String completedAt) {
        public static IslandFocusRecord from(IslandRecordViews.FocusRecord value) {
            if (value == null) {
                return null;
            }
            return new IslandFocusRecord(
                    value.id(),
                    value.subject(),
                    value.activeSeconds(),
                    value.completedAt());
        }
    }

    public record IslandFocusMember(
            String userId,
            String name,
            String catColor,
            long totalSeconds,
            List<RecordDaySeconds> series) {
        public static IslandFocusMember from(IslandRecordViews.FocusMember value) {
            if (value == null) {
                return null;
            }
            return new IslandFocusMember(
                    value.userId(),
                    value.name(),
                    value.catColor(),
                    value.totalSeconds(),
                    value.series() == null ? null : value.series().stream().map(RecordDaySeconds::from).toList());
        }
    }

    public record ScreenDayView(
            String date,
            Integer minutes,
            String measurementStatus,
            String updatedAt) {
        public static ScreenDayView from(IslandRecordViews.ScreenDay value) {
            if (value == null) {
                return null;
            }
            return new ScreenDayView(
                    value.date(),
                    value.minutes(),
                    value.measurementStatus(),
                    value.updatedAt());
        }
    }

    public record ScreenMemberView(
            String userId,
            String name,
            String catColor,
            Integer minutes,
            String measurementStatus,
            List<ScreenDayView> series,
            String updatedAt) {
        public static ScreenMemberView from(IslandRecordViews.ScreenMember value) {
            if (value == null) {
                return null;
            }
            return new ScreenMemberView(
                    value.userId(),
                    value.name(),
                    value.catColor(),
                    value.minutes(),
                    value.measurementStatus(),
                    value.series() == null ? null : value.series().stream().map(ScreenDayView::from).toList(),
                    value.updatedAt());
        }
    }

    public record ScreenTimeDayView(
            String date,
            Integer minutes,
            String measurementStatus) {
        public static ScreenTimeDayView from(IslandRecordViews.ScreenTimeDay value) {
            if (value == null) {
                return null;
            }
            return new ScreenTimeDayView(
                    value.date(),
                    value.minutes(),
                    value.measurementStatus());
        }
    }

    public record IslandLedgerEntry(
            UUID id,
            String direction,
            String reason,
            int amount,
            Instant createdAt,
            Instant groupedUntil,
            int entryCount) {
        public static IslandLedgerEntry from(IslandLedger.Entry value) {
            if (value == null) {
                return null;
            }
            return new IslandLedgerEntry(
                    value.id(),
                    value.direction(),
                    value.reason(),
                    value.amount(),
                    value.createdAt(),
                    value.groupedUntil(),
                    value.entryCount());
        }
    }

    public record FishEarningsView(
            List<FishEarningsMember> members) {
        public static FishEarningsView from(IslandFishEarnings value) {
            if (value == null) {
                return null;
            }
            return new FishEarningsView(
                    value.members() == null ? null : value.members().stream().map(FishEarningsMember::from).toList());
        }
    }

    public record FishEarningsMember(
            UUID userId,
            String name,
            Long earnedFish) {
        public static FishEarningsMember from(IslandFishEarnings.Member value) {
            if (value == null) {
                return null;
            }
            return new FishEarningsMember(
                    value.userId(),
                    value.name(),
                    value.earnedFish());
        }
    }

    public record IslandRankingView(int rank, String islandId, String name, long averageFocusSeconds) {
        public static IslandRankingView from(IslandRankingViews.IslandRanking value) {
            if (value == null) {
                return null;
            }
            return new IslandRankingView(value.rank(), value.islandId(), value.name(), value.averageFocusSeconds());
        }
    }
}
