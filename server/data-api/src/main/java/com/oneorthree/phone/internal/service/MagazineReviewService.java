package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.id.UuidV7;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.content.exception.ContentErrorCode;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.repository.ContentStore;
import com.oneorthree.phone.content.service.ContentJson;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.support.MagazineEditorial;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;

/** 비공개 검토 결과와 실제 발행을 같은 불변 스냅샷으로 묶는다. */
@Service
@RequiredArgsConstructor
public class MagazineReviewService {
    private final MagazinePublishService publisher;
    private final IslandFocusAverageSnapshotService averageSnapshots;
    private final ContentStore store;
    private final PlatformTransactionManager transactionManager;
    private final Clock clock;

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public Preview preview(PreviewRequest request, String actor) {
        if (request == null || request.issueDate() == null
                || (request.editorialBody() != null && (request.editorialBody().isBlank()
                    || request.editorialBody().codePointCount(0, request.editorialBody().length()) > 80))) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        requirePublicationWindow(request.issueDate());
        // 집계가 끝난 뒤 별도 읽기 스냅샷을 연다. 평균의 섬 잠금은 검토 트랜잭션 전에 해제한다.
        averageSnapshots.snapshot(request.issueDate());
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        return transaction.execute(status -> createPreview(request, actor));
    }

    private Preview createPreview(PreviewRequest request, String actor) {
        requirePublicationWindow(request.issueDate());
        MagazinePublishService.Review review = publisher.preview(request.issueDate(), request.editorialBody());
        UUID id = UuidV7.next();
        String digest = ContentJson.digest(review);
        store.snapshot(id, digest, ContentJson.write(review), actor, clock.instant());
        return new Preview(id, digest, review.issueDate(), review.issueNo(), review.editorial(), review.cells());
    }

    @Transactional
    public Published publish(UUID publicationId, PublishRequest request, String actor) {
        if (request == null || request.snapshotId() == null || request.digest() == null
                || !request.digest().matches("[a-f0-9]{64}")) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        String digest = ContentJson.digest(request);
        store.lock(publicationId);
        String previous = store.replay(publicationId, "MAGAZINE", digest);
        if (previous != null) {
            return ContentJson.read(previous, Published.class);
        }
        MagazinePublishService.Review review = ContentJson.read(
                store.snapshot(request.snapshotId(), request.digest()), MagazinePublishService.Review.class);
        requirePublicationWindow(review.issueDate());
        List<UUID> islandIds = new java.util.ArrayList<>();
        review.cells().forEach(cell -> islandIds.add(cell.islandId()));
        review.editorial().ranking().forEach(row -> islandIds.add(row.island().islandId()));
        review.editorial().newIslands().forEach(row -> islandIds.add(row.islandId()));
        store.lockMagazine(islandIds);
        MagazineIssue issue = publisher.publishReviewed(review);
        Published result = new Published(publicationId, issue.getId(), issue.getIssueDate(), issue.getIssueNo(),
                issue.getPublishedAt());
        store.record(publicationId, "MAGAZINE", digest, ContentJson.write(result), actor, clock.instant());
        return result;
    }

    private void requirePublicationWindow(LocalDate issueDate) {
        ZonedDateTime now = ZonedDateTime.now(clock.withZone(ZonePolicy.KST));
        if (!issueDate.equals(now.toLocalDate()) || now.toLocalTime().isBefore(LocalTime.of(7, 0))) {
            throw new ContentException(ContentErrorCode.CONTENT_PUBLICATION_WINDOW);
        }
    }

    public record PreviewRequest(LocalDate issueDate, String editorialBody) { }

    public record PublishRequest(UUID snapshotId, String digest) { }

    public record Preview(UUID snapshotId, String digest, LocalDate issueDate, int issueNo,
                          MagazineEditorial editorial, List<MagazinePublishService.ReviewCell> cells) { }

    public record Published(UUID publicationId, UUID issueId, LocalDate issueDate, int issueNo, Instant publishedAt) { }
}
