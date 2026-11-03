import React from 'react';

// 앱 라우트에서 게시판(board·notice·noticeEdit·quest·questEdit)과
// 우체통(mail·friendMail)을 건물 안 장면으로 그린다. 크기는 실제 화면(키보드로 줄어든 높이 포함)을 따른다
// 장면을 통째로 키운 우체통 안에서 뒤로 동그라미를 다른 건물과 같은 크기(원 34 · 누르는 자리 44)로 되돌리는 배율.
// InteriorRoute 가 1/k 를 넣고, 그 밖(시안 비교 화면·테스트)은 1 이다
export const NavScale = React.createContext(1);
