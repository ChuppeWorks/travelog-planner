# 전세계 여행 계획·기록 수요 조사

조사 기준일: 2026-06-09

이 문서는 공개 제품 기능, 공식 도움말, Notion Marketplace의 인기 템플릿,
여행자 커뮤니티의 반복 불만, 관련 연구를 교차 검토한 결과다. 정량 설문
원자료가 아니라 공개 신호를 바탕으로 한 제품 발견 조사이므로, 출시 후 실제
사용자 인터뷰와 행동 데이터로 우선순위를 다시 검증해야 한다.

## 결론

시장은 이미 여행 추천 앱으로 붐비지만, 사용자가 직접 세운 계획을 현실적인
시계열로 정리하고 여행 중 변경을 안전하게 반영하는 문제는 충분히 해결되지
않았다. Travelog가 차별화할 지점은 "AI가 여행지를 추천한다"가 아니라 다음
세 가지다.

1. 점(장소)과 선(이동)을 동일한 시계열의 일급 객체로 다룬다.
2. 원래 계획, 현재 수정된 계획, 실제 기록을 서로 덮어쓰지 않는다.
3. 운영시간·이동시간·예약·지연 같은 제약에 따라 계획의 파급 변경을 설명하고
   사용자가 승인할 수 있게 한다.

## 사용자가 반복적으로 원하는 것

### 반드시 잘해야 하는 핵심

| 수요 | 사용자 문제 | 무료 도구에서 제공 | 향후 Travelog 기회 |
|---|---|---|---|
| 한곳에 모으기 | 지도, 메일, 문서, 스프레드시트, 스크린샷이 흩어짐 | 여행/날짜/시계열 통합 | 예약 메일·외부 서비스 자동 수집 |
| 현실적인 일별 시계열 | 이동시간을 빼먹은 일정은 실행 불가능 | 점과 선을 모두 시간축에 표시 | 실시간 교통·환승 기반 재계산 |
| 빠르고 유연한 수정 | 날씨, 피로, 지연으로 계획은 반드시 바뀜 | 항목 이동, 이후 일정 시간 이동 | 영향 범위 미리보기와 자동 재계획 |
| 운영시간 경고 | 도착했는데 문을 닫았거나 예약시간을 놓침 | 저장된 운영시간과 일정 충돌 경고 | Places 데이터와 특별 운영시간 동기화 |
| 지도와 장소 검색 | 장소의 위치 관계를 보며 일정을 짜고 싶음 | 좌표·주소·외부 지도 링크 보존 | 검색, 지도, 경로 최적화 |
| 예산·다중 통화 | 계획 비용과 실제 지출을 함께 보고 싶음 | 계획 지출 필드 | 환율, 정산, 실제 지출 분석 |
| 예약·문서 | 표, QR, 티켓, 확인번호를 즉시 찾고 싶음 | 링크·첨부 참조 구조 | 메일 파싱, 오프라인 문서 지갑 |
| 협업 | 가족·친구의 의견과 비용을 조율하기 어려움 | Notion 협업 활용 | 권한, 투표, 충돌 해결 |
| 오프라인·모바일 | 여행 중 통신과 한 손 조작이 불안정함 | Obsidian 로컬 데이터 | 모바일 오프라인 앱과 동기화 |
| 기록·사진 | 여행 후 경로와 사진, 이야기를 다시 보고 싶음 | 미래용 actual/attachment 필드 | 자동 기록, 사진 연결, 공유/책 |
| 데이터 소유권 | 서비스 종료·잠금·개인정보 수집이 걱정됨 | 공개 스키마와 내보내기 | 선택적 동기화와 투명한 권한 |

### 사용자별 추가 요구

- **자유여행자:** 관심 장소 보관함, 느슨한 일정, 즉흥 변경, 현지 팁.
- **치밀한 계획자:** 분 단위 일정, 운영시간, 예약, 변경 이력, 인쇄/PDF.
- **그룹 여행자:** 실시간 협업, 참석 여부, 역할, 투표, 비용 분담.
- **장기·다도시 여행자:** 시간대, 다중 통화, 숙박, 교통 연결, 오프라인.
- **로드트립 여행자:** 경유지, 주행시간, 연료·충전, 경로 최적화.
- **여행 기록 중심 사용자:** 자동 경로, 사진·영상, 글, 통계, 공유, 실물 책.
- **접근성 요구 사용자:** 보행량, 휴식, 계단/휠체어, 식사·의약품 제약.

## 현재 제품에서 확인되는 수요

### Wanderlog

Wanderlog는 일정, 지도, 예약, 협업, 예산, 체크리스트를 한 제품에 모은다.
장소 사이의 이동시간과 교통수단을 보여주고 하루 경로를 최적화한다. 이는
"장소 목록"보다 점 사이의 선이 중요하다는 강한 시장 검증이다. 동시에 사용자
커뮤니티에서는 기능·광고·추천이 너무 많아 화면이 복잡하고, 오프라인 같은
기본 기능이 유료라는 불만이 반복된다.

### TripIt

TripIt의 핵심 가치는 예약 확인 메일을 일정으로 자동 변환하는 것이다. 무료
버전도 통합 일정, 공유, 지도, 문서 보관을 제공하며 Pro는 실시간 지연·게이트
변경·대체편·출발 알림을 판다. 사용자가 돈을 내는 지점은 정적인 계획 작성보다
"여행 중 문제가 생겼을 때의 대응"이라는 점을 보여준다.

### Polarsteps

Polarsteps는 계획, 자동 경로 추적, 사진·영상·글, 공유, 회고를 연결하고 앱은
무료로 제공한 뒤 여행 책을 판매한다. 기록 결과물이 결제로 이어질 수 있다는
증거이며, Travelog도 향후 고품질 PDF·책·영상 같은 여행 후 상품을 고려할 수
있다.

### Roadtrippers

Roadtrippers는 경유지와 지도 사이를 오가며 계획하고, 효율적인 경로·오프라인
지도·교통 정보를 유료 기능으로 둔다. 점의 순서와 선의 비용을 함께 최적화하는
수요가 특히 로드트립에서 강하다.

### Notion Marketplace

Notion의 Travel Planner 카테고리에는 899개 템플릿이 노출되어 경쟁이 매우
높다. 인기 템플릿은 일정, 장소, 예산, 체크리스트, 예약, 문서, 기록을
"all-in-one"으로 묶는다. 반면 대부분은 장소와 이동을 구분된 시계열 객체로
모델링하지 않고, 원래 계획과 변경된 계획을 분리하지 않는다. 이것이 무료
Travelog 템플릿의 명확한 차별점이다.

## 제품 설계에 직접 반영할 원칙

1. **추천보다 실행 가능성:** 운영시간, 이동시간, 휴식, 예산, 예약 제약을 먼저
   다룬다.
2. **AI는 제안자:** 자동 생성·재배치는 수정 가능해야 하고, 적용 전 변경 영향과
   되돌리기를 제공해야 한다.
3. **복잡성을 점진적으로 공개:** 처음에는 여행, 날짜, 장소, 이동만 보이고
   세부 필드는 필요할 때 연다.
4. **계획을 덮어쓰지 않기:** `baseline`, `current`, `actual`, `planChanges`를
   별도로 보존한다.
5. **로컬 우선과 개방형 데이터:** Obsidian 원본과 공통 JSON 스키마를 사용자의
   자산으로 취급한다.
6. **모바일·오프라인을 기본 기대치로 보기:** 유료화는 단순 열람 차단보다
   실시간 연동과 자동화에서 한다.
7. **여행 빈도에 맞춘 가격:** 연간 구독만 강제하지 않는다.

## 수익화 가설 평가

사용자가 가끔만 여행하기 때문에 여행 단위 결제와 평생 구매를 제공한다는
가설은 공개 불만과 잘 맞는다. Wanderlog 커뮤니티에는 단 한 번의 여행을 위해
연간 요금을 내고 싶지 않으며 월간 또는 여행 단위 가격을 원한다는 의견이
반복된다.

권장 가격 구조:

- **무료:** Obsidian 플러그인, Notion 템플릿, 수동 계획, 공통 데이터 내보내기.
- **Trip Pass:** 여행 한 건에 실시간 연동, 자동 재계획, 동행 협업, 오프라인
  패키지, 기록 기능을 여행 종료 후 일정 기간까지 제공.
- **Lifetime:** 핵심 Travelog 기능 평생 사용. 비용이 계속 발생하는 외부 API
  호출은 합리적인 사용량 또는 별도 크레딧으로 제한.
- **선택 상품:** 고품질 여행 책/PDF/영상, 추가 저장공간, 선물용 Trip Pass.

주의할 점: 여행 단위 결제는 결제 시점이 명확하지만, 짧은 주말여행에는 부담이
될 수 있다. 여러 가격을 동시에 제시하기보다 출시 실험에서 `무료 -> Trip Pass`
전환을 먼저 검증해야 한다.

## 기술·플랫폼 제약

- Notion CSV 가져오기는 데이터베이스를 만들 수 있지만 relation 속성을 자동
  매핑하지 못한다. 따라서 배포 패키지는 CSV와 함께 relation 설정 지침을
  제공하고, 최종 Marketplace 배포본은 Notion 안에서 네이티브 relation을
  구성해야 한다.
- Notion의 Place 속성은 지도 보기에 쓸 수 있지만 API에서 완전히 지원되지
  않는다. 동기화를 위해 좌표·주소·provider ID를 별도 속성으로 유지해야 한다.
- Google Photos Library API는 2025-03-31 이후 일반 사용자 라이브러리 전체
  읽기 범위를 제거했다. 향후 연동은 사용자가 선택하는 Picker API를 중심으로
  설계해야 한다.
- Google Places는 이름 검색, 주소, 좌표, 운영시간을 제공할 수 있지만 비용,
  표시 의무, 데이터 보존 정책을 반영해야 한다.
- Obsidian 공식 배포에는 GitHub 릴리스와 community plugin 제출이 필요하다.

## 출처

- Wanderlog 기능 및 도움말: https://wanderlog.com/ ,
  https://help.wanderlog.com/hc/en-us ,
  https://help.wanderlog.com/hc/en-us/articles/13545624787867-Optimize-route
- TripIt 기능 및 가격: https://www.tripit.com/web ,
  https://www.tripit.com/web/pro/pricing
- Polarsteps 기능 및 수익 모델: https://www.polarsteps.com/ ,
  https://support.polarsteps.com/hc/en-us/articles/29003435822866-Is-Polarsteps-free
- Roadtrippers 기능: https://support.roadtrippers.com/hc/en-us/articles/202594209-Planning-a-Trip-in-Our-Mobile-App ,
  https://support.roadtrippers.com/hc/en-us/articles/360000831566-What-features-are-included-with-Roadtrippers-memberships
- Notion 여행 템플릿 시장: https://www.notion.com/templates/category/travel
- Notion CSV 제약: https://www.notion.com/help/import-data-into-notion
- Notion 데이터 속성/API 제약: https://developers.notion.com/reference/property-object
- Obsidian 플러그인 배포: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Google Photos 권한 변경: https://developers.google.com/photos/overview/authorization
- Google Places Autocomplete: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
- 여행 일정 최적화 연구: https://doi.org/10.1016/j.asoc.2024.111399
- 일정 수정 연구: https://arxiv.org/abs/2601.10609
- 커뮤니티 신호:
  https://www.reddit.com/r/TravelPlanners/comments/1poq3cn/does_anyone_actually_enjoy_using_wanderlog_i_feel/ ,
  https://www.reddit.com/r/SideProject/comments/1tu3m2l/i_built_an_ios_travel_planning_app_after_getting/ ,
  https://www.reddit.com/r/wanderlog/comments/1gahkpf/wanderlog_pro/
