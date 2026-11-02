// 공개 저장소와 브라우저 번들에 그대로 실린다. IP·계정 번호·비밀값을 넣지 않는다.
export type MonitoringLink = { name: string; url: string; note?: string };
export type MonitoringGroup = { title: string; hint?: string; command?: string; links: MonitoringLink[] };

export const GRAFANA_TUNNEL = 'gcloud compute ssh gromo-dev-app --project=oneorthree2 --zone=asia-northeast3-a -- -N -L 13000:localhost:3000';

const DATADOG = 'https://us5.datadoghq.com';
const POSTHOG = 'https://us.posthog.com/project/669473';
const GRAFANA = 'http://localhost:13000/d';
const AWS = 'https://ap-northeast-2.console.aws.amazon.com';
const REPO = 'https://github.com/OneOrThree/phone';

export const MONITORING_GROUPS: MonitoringGroup[] = [
  {
    title: '운영 서버 · Datadog',
    hint: '운영 서버를 볼 때 먼저 여는 곳입니다.',
    links: [
      { name: '운영 V2 로그', url: `${DATADOG}/logs?query=env%3Aprod%20service%3A%28data-api%20OR%20business-api%20OR%20realtime%20OR%20notification%20OR%20nginx%29` },
      { name: '모니터 전체', url: `${DATADOG}/monitors/manage` },
      { name: 'ERROR 로그 알림', url: `${DATADOG}/monitors/23468982` },
      { name: '없는 경로 404 알림', url: `${DATADOG}/monitors/23469020` },
      { name: 'API 5xx 알림', url: `${DATADOG}/monitors/23469271` },
      { name: 'APM 서비스', url: `${DATADOG}/apm/services?query=env%3Aprod` },
      { name: '서버 목록', url: `${DATADOG}/infrastructure` },
      { name: '컨테이너', url: `${DATADOG}/containers?query=env%3Aprod` },
    ],
  },
  {
    title: 'Datadog 대시보드',
    links: [
      { name: 'Catus 앱 성능·RUM', url: `${DATADOG}/dashboard/qp2-2ym-yyh`, note: '2.0 앱 전용' },
      { name: 'CATUS · PROD 통합 관측', url: `${DATADOG}/dashboard/z2h-qq5-8vk`, note: 'V1 필터가 남아 서버 그래프가 비어 보입니다' },
      { name: 'CATUS · DEV 통합 관측', url: `${DATADOG}/dashboard/hav-c4v-rkm`, note: 'dev V2 서버는 Datadog에 보고하지 않습니다' },
      { name: 'GROMO dev 서버 아키텍처', url: `${DATADOG}/dashboard/p5y-imc-n2t`, note: '옛 dev' },
      { name: 'gromo 백엔드 관측', url: `${DATADOG}/dashboard/mdh-sxt-jta`, note: '1.x 시기' },
      { name: 'gromo 앱 RUM', url: `${DATADOG}/dashboard/6ht-g45-i9n`, note: '1.x 앱' },
    ],
  },
  {
    title: 'Grafana · 옛 dev 서버',
    hint: '운영 Grafana는 꺼져 있습니다. 내 컴퓨터에서 아래 터널을 켠 뒤 링크를 엽니다. 지표는 일부만 수집되고 로그 패널은 비어 있습니다.',
    command: GRAFANA_TUNNEL,
    links: [
      { name: '트래픽·쿼리', url: `${GRAFANA}/gromo-overview` },
      { name: '전체 컴포넌트', url: `${GRAFANA}/gromo-components` },
      { name: 'Redis·Kafka', url: `${GRAFANA}/redis-kafka-ops` },
    ],
  },
  {
    title: '앱 사용자 · PostHog',
    links: [
      { name: '첫 섬과 집중', url: `${POSTHOG}/dashboard/2220995` },
      { name: '섬과 친구', url: `${POSTHOG}/dashboard/2234114` },
      { name: '오류와 수집 상태', url: `${POSTHOG}/dashboard/2234116`, note: '2.0 앱 오류는 여기서 봅니다' },
      { name: '섬 성장과 경제', url: `${POSTHOG}/dashboard/2236458` },
      { name: '이벤트 목록', url: `${POSTHOG}/activity/events` },
      { name: '세션 리플레이', url: `${POSTHOG}/replay` },
    ],
  },
  {
    title: '운영 현황 · 서버 상태',
    links: [
      { name: '성과 현황', url: 'https://oneorthree.world/status', note: '비밀번호 필요' },
      { name: '운영 서버 상태', url: 'https://catus-api-v2.oneorthree.world/health' },
      { name: 'dev V2 서버 상태', url: 'https://oneorthree-v2.dev.mooo.com/health' },
      { name: '옛 dev 서버 상태', url: 'https://oneorthree.dev.mooo.com/health' },
      { name: 'CI/CD 실행 기록', url: `${REPO}/actions` },
      { name: '배포 기록', url: `${REPO}/deployments` },
    ],
  },
  {
    title: '클라우드 콘솔',
    links: [
      { name: 'AWS CloudWatch 경보', url: `${AWS}/cloudwatch/home?region=ap-northeast-2#alarmsV2:`, note: '경보에 수신처가 없어 알림이 오지 않습니다' },
      { name: 'AWS RDS', url: `${AWS}/rds/home?region=ap-northeast-2#databases:` },
      { name: 'AWS EC2', url: `${AWS}/ec2/home?region=ap-northeast-2#Instances:` },
      { name: 'GCP VM (dev)', url: 'https://console.cloud.google.com/compute/instances?project=oneorthree2' },
      { name: 'Cloudflare', url: 'https://dash.cloudflare.com/' },
      { name: 'Firebase 운영', url: 'https://console.firebase.google.com/project/catus-prod/overview' },
      { name: 'Firebase dev', url: 'https://console.firebase.google.com/project/catus-dev/overview' },
      { name: 'Airbridge', url: 'https://dashboard.airbridge.io/app/catus', note: '앱 이름으로 추정한 주소입니다' },
    ],
  },
];
