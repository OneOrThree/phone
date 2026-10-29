# 이미지 CDN 계획: AWS 공식 근거 검증

확인일: 2026-10-29. AWS 공식 문서만 사용했다. 아래 권고는 문서의 제약을 적용한 설계 판단이며, 실제 AWS 계정 설정이나 배포 상태는 확인하지 않았다.

## 1. S3 비공개 원본과 OAC

AWS는 S3 원본에 OAI보다 OAC를 권장한다. 일반 S3 버킷 원본을 사용해야 하며, S3 website endpoint에는 OAC를 사용할 수 없다. `SigningBehavior: always`, `SigningProtocol: sigv4`를 사용하면 CloudFront→S3 요청을 서명하고 HTTPS로 통신한다. 버킷 정책은 `cloudfront.amazonaws.com` 서비스 주체에 필요한 읽기 권한을 주고, `AWS:SourceArn`을 해당 distribution ARN으로 제한한다. Object Ownership은 보통 `Bucket owner enforced`를 사용한다. [AWS: S3 원본 접근 제한](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)

설계 판단: 이미지 공개 제공과 S3 직접 공개는 구분한다. 공개 CDN URL이 목적이어도 S3는 비공개 원본으로 유지할 수 있다. OAC 자체가 최종 이용자 인증을 제공한다는 의미는 아니다.

## 2. 변경하지 않는 버전 경로

AWS는 파일명 또는 디렉터리에 버전 식별자를 넣어 새 객체를 제공하는 방식을 권장한다. 새 버전 URL로 링크를 바꾸면 이전 객체의 캐시 만료를 기다리거나 무효화할 필요가 없다. 이 방식은 S3 Object Versioning과 별개이며, 버전 경로에도 캐시 만료 설정을 권장한다. [AWS: 파일 버전으로 콘텐츠 갱신](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/UpdatingExistingObjects.html)

설계 판단: `/images/<content-hash>.webp` 또는 `/images/vN/...`를 쓰고 이미 공개한 경로의 바이트를 덮어쓰지 않는다. `Cache-Control: public, max-age=31536000, immutable`은 이런 불변성 계약을 전제로 하는 제안값이다. 위 AWS 문서가 `immutable` 지시어 자체의 CloudFront 지원이나 필수 사용을 보장하는 것은 아니다. CloudFront 캐시 기간은 `max-age`/`s-maxage`와 캐시 정책 TTL의 조합으로 결정된다. [AWS: 캐시 만료 제어](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)

## 3. 변경 가능한 manifest의 캐시 정책

`Minimum TTL > 0`이면 CloudFront는 원본의 `no-cache`, `no-store`, `private`에도 불구하고 최소 TTL 동안 캐시한다. TTL 세 값(Minimum/Default/Maximum)을 모두 0으로 설정하면 CloudFront 캐시가 비활성화된다. Default TTL은 원본이 캐시 헤더를 보내지 않을 때 적용된다. [AWS: 캐시 정책 TTL](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html)

AWS 관리형 `CachingOptimized`는 Minimum TTL 1초, Default TTL 24시간, Maximum TTL 365일이다. `CachingDisabled`는 세 값 모두 0이다. [AWS: 관리형 캐시 정책](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)

설계 판단: `/manifest.json`처럼 내용이 바뀌는 고정 URL은 이미지와 별도 cache behavior를 사용한다. 최신 버전을 매번 확인해야 한다면 Minimum TTL 0과 적절한 원본 응답 캐시 헤더를 사용하거나, 더 단순하게 `CachingDisabled`와 브라우저용 `Cache-Control: no-store`를 사용한다. 재검증 전략과 완전한 캐시 비활성화 전략은 서로 다른 선택이다. 요청 측 `Cache-Control`만 추가해 CloudFront 재검증을 강제할 수는 없다. [AWS: 요청 헤더 및 만료 동작](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)

## 4. 커스텀 도메인과 ACM

이용자↔CloudFront HTTPS에 ACM 인증서를 사용하려면 인증서를 `us-east-1`에서 발급하거나 가져와야 한다. 인증서 SAN은 distribution에 추가하는 alternate domain name을 정확히 또는 같은 레벨의 wildcard로 포함해야 한다. 이 리전 조건은 원본 S3 버킷의 리전을 `us-east-1`로 강제하는 조건이 아니다. [AWS: CloudFront TLS 인증서 요구사항](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)

## 5. 오류 캐시와 발행 순서

CloudFront 오류 캐시 기본값은 10초이며 오류 코드별 Error Caching Minimum TTL을 설정할 수 있다. 캐시가 활성화된 S3 원본에서는 이 값을 0으로 해도 원본 오류가 최소 1초 캐시된다. 원본이 `max-age`/`s-maxage` 또는 `Expires`를 주면 오류 TTL과 헤더 중 큰 값이 적용되며 관련 Maximum TTL 제약도 받는다. `no-store`/`no-cache`/`private`로 오류 캐시를 막는 처리는 404·410·414·501에만 적용되고, 다른 오류는 해당 지시어를 무시한다. [AWS: 오류 캐시 기간](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-expiration.html)

설계 판단: 이미지 객체 업로드와 읽기 확인을 마친 다음 manifest를 갱신한다. 객체 생성 전 URL이 노출되면 오류가 캐시되어 업로드 후에도 잠시 실패할 수 있다. 오류 캐시를 0으로 설정하면 모든 실패가 즉시 해소된다고 설명하지 않는다. 실제 발행 검증에는 객체 응답과 manifest 응답의 HTTP 상태 및 Cache-Control을 포함한다.
