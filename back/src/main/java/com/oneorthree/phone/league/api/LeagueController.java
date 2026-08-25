package com.oneorthree.phone.league.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.league.api.docs.LeagueControllerDocs;
import com.oneorthree.phone.league.dto.LeagueLastResultAckRequest;
import com.oneorthree.phone.league.dto.LeagueLastResultResponse;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.service.LeagueService;
import com.oneorthree.phone.user.domain.Occupation;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 리그·티어 API. Swagger 애노테이션은 {@link LeagueControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class LeagueController implements LeagueControllerDocs {

    private final LeagueService leagueService;

    @Override
    @GetMapping("/league/me/tier")
    public ResponseEntity<LeagueTierResponse> getMyTier(@LoginUser UUID userId) {
        return ResponseEntity.ok(leagueService.getMyTier(userId));
    }

    @Override
    @GetMapping("/league/me/ranking")
    public ResponseEntity<List<LeagueMemberResponse>> getMyRanking(
            @LoginUser UUID userId,
            @RequestParam(required = false) Occupation category,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ResponseEntity.ok(leagueService.getMyRanking(userId, category, date));
    }

    // 전역 랭킹은 유저 컨텍스트가 필요 없다(직군·본인 무관 집계). 인증은 JwtFilter(/api/*)가 강제하므로
    // 핸들러에서 userId 를 읽지 않는다. request 파라미터도 불필요.
    @Override
    @GetMapping("/league/ranking")
    public ResponseEntity<List<LeagueMemberResponse>> getGlobalRanking(
            @RequestParam(required = false, defaultValue = "total") String scope,
            @RequestParam(required = false, defaultValue = "100") int limit) {
        return ResponseEntity.ok(leagueService.getGlobalRanking(scope, limit));
    }

    @Override
    @GetMapping("/league/me/rank")
    public ResponseEntity<LeagueRankResponse> getMyRank(@LoginUser UUID userId) {
        return ResponseEntity.ok(leagueService.getMyRank(userId));
    }

    @Override
    @GetMapping("/league/me/schedule")
    public ResponseEntity<LeagueScheduleResponse> getMySchedule(@LoginUser UUID userId) {
        return ResponseEntity.ok(leagueService.getMySchedule(userId));
    }

    @Override
    @GetMapping("/league/me/last-result")
    public ResponseEntity<LeagueLastResultResponse> getLastResult(@LoginUser UUID userId) {
        return ResponseEntity.ok(leagueService.getLastResult(userId));
    }

    @Override
    @PostMapping("/league/me/last-result/ack")
    public ResponseEntity<Void> acknowledgeLastResult(
            @LoginUser UUID userId,
            @RequestBody LeagueLastResultAckRequest body) {
        leagueService.acknowledgeLastResult(userId, body.weekStartAt());
        return ResponseEntity.ok().build();
    }
}
