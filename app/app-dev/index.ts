import { registerRootComponent } from 'expo';
import App from './src/App';
import { InteriorsReview } from '@/screens/interiors/BuildingInteriors';
import { InteriorsGalleryReview } from '@/screens/interiors/InteriorsGallery';

// 웹에서 ?interiors 로 열면 건물 내부 화면 하나만, ?gallery 로 열면 원본 구경용 페이지를 띄워 픽셀 비교한다
const query =
  typeof window !== 'undefined' && typeof window.location !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;
registerRootComponent(
  query?.has('gallery') ? InteriorsGalleryReview : query?.has('interiors') ? InteriorsReview : App,
);
