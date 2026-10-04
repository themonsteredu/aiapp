# 광장 2단계 공개 그림

작성일: 2026-10-04. 0단계 공통 스타일을 기준으로 내장 imagegen 도구로 생성했다. 학생별 작품이나 실물 재료 사진이 아니다.

| 사용 파일 | 생성 원본·웹 파일 | 용도 |
|---|---|---|
| `public/brand/plaza/plaza-background.webp` | 1672×941 원본, 같은 크기의 WebP | 비어 있는 공방 광장 배경 |
| `public/brand/plaza/store-shell.webp` | 1254×1254 RGBA 원본, 512×512 WebP | 빈 간판과 전시창이 있는 가게 틀 |

이미지에는 글자·버튼·저장 표시를 넣지 않았다. 저장한 가게 이름과 전시·버튼은 HTML이며 사진은 인증 경로로만 표시한다. 웹 파일 압축 후 알파와 밝은 배경 합성을 눈으로 확인했다. 가게 원본의 간판 내부 약 x=185..1060, y=257..380, 전시창 약 x=455..1002, y=594..917을 기준으로 CSS 비율을 정했다. 작은 광장에서는 간판을 줄여 표시하고 이름 목록과 상세 화면에서 전체 내용을 읽는다. 최종 태블릿 가독성은 실기기 확인이 남아 있다.

광장 프롬프트:

```text
Use case: stylized-concept. Asset type: school career education web app background. 학교 진로수업 웹앱에 사용할 작은 공방 광장의 배경 한 장. 실제 건축 모형을 정교하게 촬영한 듯한 자연스럽고 전문적인 미니어처 공간. 약간 위에서 내려다보는 고정된 정사영에 가까운 시점, 부드러운 낮의 확산광, 아이보리 바닥과 절제된 티일 포인트. 중앙에 작은 광장과 가게로 이어질 동선이 있고, 가장자리와 중앙 주변에는 웹앱이 가게를 배치할 충분히 넓고 비어 있는 영역을 남긴다. 완성된 가게나 읽을 수 있는 간판은 배경에 넣지 않는다. 여러 가게 요소를 나중에 겹쳐도 복잡해지지 않는 단순한 공간. 사람, 캐릭터, 글자, 숫자, 로고, 이모지, 버튼, UI, 워터마크 없음. 16:9 가로 화면, 2560×1440 기준. 지나치게 만화 같거나 반짝이는 3D 장난감 질감, 채도가 높은 네온색, 과장된 원근감은 피한다. 넓은 중앙과 주변 배치 영역은 거의 비어 있는 평탄한 아이보리 바닥으로, 장식은 가장자리에만.
```

가게 틀 프롬프트:

```text
Use case: stylized-concept. Asset type: transparent store shell sprite for a school classroom plaza web app. Small, calm, realistic architectural miniature workshop facade, ivory plaster walls, natural light blond wood, restrained teal canopy, photographed from a slightly elevated nearly orthographic front camera, soft daylight from upper left. Match the style of a real architectural model rather than a toy or cartoon. One shop, square composition, full object with small margins. Very important: broad absolutely blank ivory signboard across the front upper section for later HTML shop-name text, centered rectangular completely empty display window in front lower section for later HTML artwork/photo overlay. Keep signboard and window frontal and parallel to the image plane, doors and roof do not overlap either blank area. Transparent background with actual alpha. No text, no letters, no numbers, no logos, no people, no characters, no artworks, no products, no symbols, no UI, no watermarks. Weak natural floor shadow only. 1024x1024. Avoid glossy toy plastic, neon, exaggerated perspective.
```

투명 컷아웃의 경계를 확인하기 위해 수정 변형도 생성했으나, 밝은 바탕 합성에서 최초 원본의 알파가 정상임을 확인하여 최초 원본을 사용했다. 사용하지 않은 변형은 앱에 넣지 않았다. 유료 외부 생성 API나 별도 API 키를 사용하지 않았다.
