import React, { useEffect, useState } from 'react';
import { Image, ImageSourcePropType, Platform, Pressable, Text, View } from 'react-native';
import {
  BODY_FONT,
  GOWUN,
  INK,
  InteriorScreen,
  OUTLINE,
  assetUri,
  buildings,
  exact,
  gradient,
  interiorArt,
  lh,
  useInteriorFonts,
  webOnly,
} from '@/screens/interiors/BuildingInteriors';

// 원본 구경용 페이지(preview/concepts/building-interiors-3/index.html)를 RN으로 옮긴다.
// 건물 탭 6개 + 시안 카드(제목·설명·폰 목업) 구조. 폰 안의 화면은 BuildingInteriors의 InteriorScreen을 그대로 쓴다.

const MUTED = '#826f65';
const BROWN = '#a16e55'; // .eyebrow · .section-count · .option-label
const CANVAS = '#f6f0e6';

// 크롬 레이아웃 단위(1/64px) 내림. 칸 너비·폰 높이를 원본과 같은 값으로 맞춘다
const snap = (v: number) => Math.floor(v * 64) / 64;

// 원본 app.js buildings 의 icon·summary·desc (BuildingInteriors 데이터에는 없다)
const icons: ImageSourcePropType[] = [
  interiorArt.buildings.hall,
  interiorArt.buildings.noticeboard,
  interiorArt.buildings.observatory,
  interiorArt.buildings.mailbox,
  interiorArt.buildings.shop,
  interiorArt.buildings.gramophone,
];
const summaries = [
  '둥근 회의 책상 위 미니어처 섬과 목각 건물, 공동 가계부를 직접 눌러 섬을 관리하는 공간.',
  '게시판에 붙어 있는 공지·퀘스트 포스트잇·건설 청사진을 누르면 하단에 해당 내용이 펼쳐지는 공간.',
  '밤바다가 보이는 책상 위 낡은 노트북과 오래된 지도로 다른 섬의 순위를 보고 찾아가는 공간.',
  '열린 빨간 우체통 안에서 섬 주민 모두가 보는 편지방과 친구에게 보내는 개인 편지를 분명히 나누는 공간.',
  '진열된 옷과 테마를 바로 대보고, 강아지 상점 주인의 반응과 함께 고르는 공간.',
  '레코드판을 고르고 직접 바늘을 내려, 모닥불 주변의 공동 음악을 바꾸는 공간.',
];
const descs: string[][] = [
  [
    '미니어처 섬은 섬 관리, 목각 건물은 다음 목표, 가계부는 공동 자원으로 이어지는 첫 화면.',
    '목각 건물을 누르면 실제 우리 건물 에셋과 이름·기능 요약이 담긴 그리드가 하단에서 올라와요.',
    '섬 소유 물고기의 현재 잔액과 적립·건설·공동 구매 지출만 기록한 펼친 가계부.',
    '그리드에서 건물을 누른 다음 나타나는 상세 화면. 왼쪽에는 건물, 오른쪽에는 이름·가격·기능을 보여줘요.',
    '섬 이름·소개, 가입 승인 방식과 정원을 변경하는 화면.',
    '함께 사는 주민과 방장을 확인하고 주민 관리를 시작하는 화면.',
    '새 이웃의 가입 신청을 보고 승인하거나 거절하는 화면.',
  ],
  [
    '공지·퀘스트·청사진 세 장을 눌러 내용을 펼쳐봐요.',
    '방장에게만 공지 쓰기 버튼을 제공해요.',
    '주민은 방장이 쓴 공지를 읽고 댓글을 남겨요.',
    '공지 목록을 뒤에 둔 채 선택한 공지를 화면 가운데 종이 카드로 띄워요.',
    '주민은 가운데 열린 공지 본문·댓글을 읽고 댓글을 작성할 수 있어요.',
    '제목·본문을 쓰고 게시하기를 누르면 바로 등록해요.',
    '기존 공지의 제목·본문을 수정해요.',
    '실패해도 입력 내용을 보존하고 다시 저장할 수 있어요.',
    '공지 아래에 댓글을 작성하고 실제 댓글 목록에 반영해요.',
    '내 달성률·자세히 보기, 퀘스트 생성·수정을 제공해요.',
    '내 달성률을 보고 자세히 보기에서 주민별 현황을 확인해요.',
    '고양이 프로필·이름·달성률을 세로 목록으로 보여줘요.',
    '집중·스크린타임 퀘스트를 입력하고 저장해요.',
    '대상 주민의 누적 물고기 준비량과 섬 잔액을 확인해요.',
    '전원 준비·잔액 충족 시 완료 도장과 건설하기를 보여줘요.',
    '준비가 끝나도 주민에게 건설 버튼은 제공하지 않아요.',
    '방장이 건설하면 물고기를 차감하고 공사 상태를 보여줘요.',
  ],
  [
    '책상 중앙의 낡은 노트북은 다른 섬 랭킹, 옆 지도는 섬 찾기와 구경으로 이어지는 첫 화면.',
    '낡은 노트북 화면에 다른 섬의 주간 집중 평균과 우리 섬 위치를 보여주는 화면.',
    '책상 위 지도를 펼쳐 내 소속 섬과 공개 섬을 찾고, 선택한 섬을 구경하는 화면.',
  ],
  [
    '넓은 주민 편지 묶음과 이름이 적힌 친구 봉투를 물리적으로 나눠 놓은 첫 화면.',
    '현재 섬 주민이 함께 읽고 쓰는 글을 고양이 얼굴 옆 말풍선으로 이어 보는 화면.',
    '친구를 고르고 편지지를 쓴 뒤 봉투를 접어 보내는 비동기 개인 편지 화면.',
  ],
  [
    '진열품을 누르면 고양이에게 즉시 적용되는 미리보기 중심 안.',
    '상점 주인이 골라 둔 세 상품을 넘겨 보며 구매하는 안.',
    '작은 디오라마를 돌려 보며 섬 전체 변화를 미리 보는 안.',
  ],
  [
    '보유한 음원을 색이 다른 레코드판으로 꺼내 고르는 안.',
    '턴테이블과 큰 물리 버튼으로 재생 상태를 조작하는 안.',
    '판매 음원을 앨범 커버처럼 넘겨 보고 미리 듣는 안.',
  ],
];

// 원본이 <img>라 웹에서도 같은 요소로 그려야 래스터 결과가 같다
function Img({
  source,
  size,
  alt,
  shadow,
}: {
  source: ImageSourcePropType;
  size: number;
  alt: string;
  shadow?: boolean;
}) {
  if (Platform.OS === 'web')
    return React.createElement('img', {
      src: assetUri(source),
      alt,
      style: {
        width: size,
        height: size,
        objectFit: 'contain',
        ...(shadow ? { filter: 'drop-shadow(0 5px 4px #4a342a35)' } : null),
      },
    });
  return (
    <Image
      source={source}
      accessibilityLabel={alt || undefined}
      resizeMode="contain"
      style={{ width: size, height: size }}
    />
  );
}

export function InteriorsGallery({
  width,
  reduceMotion = false,
  initialBuilding = 0,
}: {
  width: number;
  reduceMotion?: boolean;
  initialBuilding?: number;
}) {
  const [active, setActive] = useState(initialBuilding);
  const building = buildings[active];

  // main(최대 1240 · 좌우 24+6=30씩) 안쪽 폭에서 gap 24 두 개를 뺀 값을 3등분한다.
  // 크롬 grid는 각 칸을 1/64px로 내리고 남는 만큼을 마지막 칸에 준다
  const inner = Math.min(width, 1240) - 60;
  const base = snap((inner - 48) / 3);
  const columns =
    Platform.OS === 'web' ? [base, base, inner - 48 - base * 2] : [inner, inner, inner];
  // 탭 좌우 여백: max(20px, (100vw - 1240)/2 + 30)
  const tabPad = Math.max(20, (width - 1240) / 2 + 30);

  return (
    <View
      testID="interiors-gallery"
      style={[
        { width, backgroundColor: CANVAS },
        gradient('radial-gradient(circle at 50% 0,#fffaf1 0 22%,transparent 55%)'),
      ]}
    >
      {/* 원본은 .screen 요소 자체가 border-radius 37px을 갖는다. 감싸는 View로 잘라내면 배경 그림 래스터가 미세하게 달라져서, 웹에서는 화면 요소에 직접 규칙을 준다 */}
      {Platform.OS === 'web'
        ? React.createElement('style', null, '[data-testid="interiors-screen"]{border-radius:37px}')
        : null}
      <View
        style={[
          {
            width: '100%',
            maxWidth: 1240,
            marginHorizontal: 'auto',
            paddingTop: 72,
            paddingHorizontal: 30,
            paddingBottom: 36,
            gap: 80,
          },
          webOnly({
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.1fr) minmax(280px,.65fr)',
            alignItems: 'end',
          }),
        ]}
      >
        <View>
          <Text
            style={{
              fontFamily: GOWUN,
              fontSize: 11,
              fontWeight: '700',
              lineHeight: lh(11 * 1.2),
              letterSpacing: 11 * 0.24,
              color: BROWN,
              marginBottom: 10,
            }}
          >
            GROMO · BUILDING STUDY
          </Text>
          <Text
            style={{
              fontFamily: GOWUN,
              fontSize: 46,
              lineHeight: lh(46 * 1.23),
              letterSpacing: 46 * -0.045,
              color: INK,
            }}
          >
            {'건물 안에서\n직접 만지는 공간과 기능'}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: BODY_FONT,
            fontSize: 14,
            lineHeight: lh(14 * 1.6),
            color: MUTED,
            maxWidth: 440,
          }}
        >
          각 장소의 물건을 눌러 기능을 열어보세요. 게시판은 방장·주민별 공지, 작성·댓글, 퀘스트와
          건설 화면을 나눠 볼 수 있어요.
        </Text>
      </View>

      <View
        testID="building-tabs"
        style={[
          {
            flexDirection: 'row',
            gap: 8,
            paddingVertical: 12,
            paddingHorizontal: tabPad,
            backgroundColor: exact('#f6f0e6e8'),
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: '#cdb9a5',
          },
          webOnly({
            position: 'sticky',
            top: 0,
            zIndex: 50,
            overflow: 'auto',
            backdropFilter: 'blur(15px)',
            scrollbarWidth: 'none',
          }),
        ]}
      >
        {buildings.map((item, i) => (
          <Pressable
            key={item.id}
            testID={`tab-${i}`}
            accessibilityRole="button"
            accessibilityState={{ selected: i === active }}
            onPress={() => setActive(i)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              minHeight: 46,
              paddingTop: 5,
              paddingRight: 14,
              paddingBottom: 5,
              paddingLeft: 7,
              borderWidth: 2,
              borderColor: OUTLINE,
              borderRadius: 999,
              backgroundColor: i === active ? '#f4a7bb' : '#fffaf1',
              boxShadow: `0 3px 0 ${OUTLINE}`,
            }}
          >
            <Img source={icons[i]} size={34} alt="" />
            <Text
              style={{
                fontFamily: BODY_FONT,
                fontSize: 15,
                lineHeight: lh(15 * 1.6),
                fontWeight: '800',
                color: INK,
              }}
            >
              {item.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <View
        style={{
          width: '100%',
          maxWidth: 1240,
          marginHorizontal: 'auto',
          paddingTop: 56,
          paddingHorizontal: 30,
          paddingBottom: 110,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 22,
            maxWidth: 760,
            marginBottom: 36,
          }}
        >
          <View
            style={{
              width: 96,
              height: 96,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: OUTLINE,
              borderRadius: 30,
              backgroundColor: '#dce9bd',
              boxShadow: `0 5px 0 ${OUTLINE}`,
              transform: [{ rotate: '-2deg' }],
            }}
          >
            <Img source={icons[active]} size={88} alt={`${building.name} 건물`} shadow />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text
              style={{
                fontFamily: GOWUN,
                fontSize: 11,
                fontWeight: '700',
                lineHeight: lh(11 * 1.2),
                letterSpacing: 11 * 0.24,
                color: BROWN,
                marginBottom: 10,
              }}
            >
              {`${String(active + 1).padStart(2, '0')} / ${String(buildings.length).padStart(2, '0')}`}
            </Text>
            <Text
              style={{
                fontFamily: GOWUN,
                fontSize: 34,
                lineHeight: lh(34 * 1.25),
                letterSpacing: 34 * -0.035,
                color: INK,
              }}
            >
              {building.name}
            </Text>
            <Text
              style={{
                fontFamily: BODY_FONT,
                fontSize: 15,
                lineHeight: lh(15 * 1.6),
                color: MUTED,
                marginTop: 5,
              }}
            >
              {summaries[active]}
            </Text>
          </View>
        </View>

        <View
          style={[
            { gap: 24 },
            webOnly({
              display: 'grid',
              gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
              alignItems: 'start',
            }),
          ]}
        >
          {building.concepts.map((concept, i) => {
            const phoneW = columns[i % 3] - 40; // 카드 padding 18*2 + 테두리 2*2
            const phoneH = snap((phoneW * 844) / 390); // aspect-ratio 390/844
            const label =
              concept.kind === 'island-management'
                ? `SCREEN ${String(i - 3).padStart(2, '0')}`
                : building.id === 'board'
                  ? `SCREEN ${String(i + 1).padStart(2, '0')}`
                  : building.concepts.length === 1
                    ? 'FINAL VIEW'
                    : `OPTION ${String.fromCharCode(65 + i)}`;
            return (
              <View
                key={`${building.id}-${i}`}
                style={[
                  {
                    paddingTop: 18,
                    paddingHorizontal: 18,
                    paddingBottom: 16,
                    borderWidth: 2,
                    borderColor: OUTLINE,
                    borderRadius: 28,
                    backgroundColor: '#fffaf3',
                    boxShadow: `0 7px 0 ${OUTLINE}`,
                  },
                  // .concept-card:nth-child(2) 만 아래로 18px
                  i === 1 && { transform: [{ translateY: 18 }] },
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <View style={{ flexShrink: 1 }}>
                    <Text
                      style={{
                        fontFamily: GOWUN,
                        fontSize: 9,
                        fontWeight: '700',
                        lineHeight: lh(9 * 1.2),
                        letterSpacing: 9 * 0.24,
                        color: BROWN,
                        marginBottom: 5,
                      }}
                    >
                      {label}
                    </Text>
                    <Text
                      style={{
                        fontFamily: GOWUN,
                        fontSize: 21,
                        lineHeight: lh(21 * 1.3),
                        letterSpacing: 21 * -0.025,
                        color: INK,
                      }}
                    >
                      {concept.title}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="이 시안 크게 보기"
                    style={{
                      minHeight: 34,
                      justifyContent: 'center',
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderWidth: 1.5,
                      borderColor: OUTLINE,
                      borderRadius: 999,
                      backgroundColor: '#fffdf8',
                      boxShadow: `0 2px 0 ${OUTLINE}`,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: BODY_FONT,
                        fontSize: 10,
                        lineHeight: lh(10 * 1.6),
                        fontWeight: '800',
                        color: INK,
                        textAlign: 'center',
                      }}
                    >
                      크게 보기
                    </Text>
                  </Pressable>
                </View>
                <Text
                  style={{
                    fontFamily: BODY_FONT,
                    fontSize: 11,
                    lineHeight: lh(11 * 1.55),
                    color: MUTED,
                    minHeight: 45,
                    marginTop: 7,
                    marginBottom: 13,
                  }}
                >
                  {descs[active][i]}
                </Text>
                <View
                  style={{
                    width: '100%',
                    aspectRatio: 390 / 844,
                    padding: 11,
                    borderWidth: 2,
                    borderColor: '#50453f',
                    borderRadius: 48,
                    backgroundColor: '#27231f',
                    boxShadow: 'inset 0 0 0 2px #7d756c,0 9px 18px #4933232b',
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      position: 'absolute',
                      zIndex: 5,
                      top: 18,
                      left: '50%',
                      width: '30%',
                      height: 25,
                      borderRadius: 99,
                      backgroundColor: '#201d1a',
                      transform: [{ translateX: '-50%' }],
                    }}
                  />
                  <InteriorScreen
                    buildingIndex={active}
                    conceptIndex={i}
                    width={phoneW - 26}
                    height={phoneH - 26}
                    reduceMotion={reduceMotion}
                  />
                  <View
                    style={{
                      position: 'absolute',
                      zIndex: 6,
                      bottom: 19,
                      left: '50%',
                      width: '28%',
                      height: 4,
                      borderRadius: 99,
                      backgroundColor: '#ece5dc',
                      transform: [{ translateX: '-50%' }],
                    }}
                  />
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    marginTop: 12,
                  }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: ['#f4a7bb', '#a9d9e7', '#f4d47d'][i % 3],
                      boxShadow: `0 0 0 4px ${exact('#f4a7bb22')}`,
                    }}
                  />
                  <Text
                    style={{
                      fontFamily: BODY_FONT,
                      fontSize: 9,
                      lineHeight: lh(9 * 1.6),
                      color: MUTED,
                    }}
                  >
                    {building.id === 'board'
                      ? '공지·퀘스트·청사진을 눌러 보세요'
                      : '색이 있는 물건을 눌러 보세요'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// 웹 비교용: /?gallery=1&b=건물&w=폭
export function InteriorsGalleryReview() {
  const q = new URLSearchParams(window.location.search);
  const [fontsLoaded] = useInteriorFonts();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  useEffect(() => {
    document.documentElement.lang = 'ko';
    // 원본처럼 문서 자체가 스크롤되게 한다 (Expo 웹 기본값은 body 스크롤 막음)
    document.body.style.overflow = 'auto';
    // Expo 개발 서버가 다시 빌드할 때 왼쪽 아래에 띄우는 번개 표시는 원본에 없으니 캡처에서 감춘다
    const hideDevBadge = document.createElement('style');
    hideDevBadge.textContent = '.__expo_fast_refresh{display:none!important}';
    document.head.append(hideDevBadge);
    const root = document.getElementById('root');
    if (root) {
      root.style.height = 'auto';
      root.style.minHeight = '100%';
    }
    if (!fontsLoaded) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => ((window as any).__interiorsReady = true)),
    );
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  return (
    <InteriorsGallery
      width={Number(q.get('w') || 1440)}
      reduceMotion={reduceMotion}
      initialBuilding={Number(q.get('b') || 0)}
    />
  );
}

// 비교 화면에서 시안 번호로 골라 쓰기 위해 다시 내보낸다
export { InteriorScreen };
