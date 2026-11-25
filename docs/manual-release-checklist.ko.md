# Refine GitHub 배포 전 수동 점검

**검사한 ZIP** __________　 **브라우저·버전** __________　 **검사일** __________

최종 배포할 ZIP을 기준으로 Chrome과 Edge에서 각각 확인한다. 직접 통과한 항목에만 체크하고, 실패하면 맨 아래에 URL과 증상을 남긴다.

## 1. 배포본 설치

- [ ] ZIP을 새 폴더에 풀고, 테스트용 브라우저 프로필에서 개발자 모드 → **압축해제된 확장 프로그램을 로드**로 `manifest.json`이 있는 폴더를 선택한다. 확장 목록의 이름과 버전이 배포 대상과 일치하고 팝업과 **Page options**가 열린다. Chrome은 `chrome://extensions`, Edge는 `edge://extensions`에서 확인한다.
- [ ] 처음 설치한 프로필에서 **Page width**는 **Default**, **Focus**와 **Side-by-side Markdown preview**는 꺼져 있다. 아래 공개 페이지를 두 탭에 열어 둔다.

## 2. 공개 URL에서 읽기 화면 확인

너비 차이가 보이도록 브라우저 창을 넓게 연다. 먼저 팝업에서 **Full width**를 선택한 다음 **Page options**에서 아래 항목을 확인한다.

| 확인 | 조작 | 통과 기준 | 열 URL |
| --- | --- | --- | --- |
| [ ] Issue | **Issues**를 960 px로 바꾸고 **Focus**를 켰다가 끈다. | 목록과 본문의 폭이 바뀐다. 상세 화면에서 오른쪽 메타데이터가 접혔다 돌아온다. | [목록](https://github.com/microsoft/TypeScript/issues) · [상세](https://github.com/microsoft/TypeScript/issues/1) |
| [ ] Pull request | **Pull requests**를 960 px로 바꾸고 **Conversation**에서 **Focus**를 전환한다. | 대화 영역의 폭이 바뀌고 사이드바가 다시 나타난다. **Files changed**로 이동해도 diff를 읽을 수 있다. | [PR 대화](https://github.com/microsoft/TypeScript/pull/65579) |
| [ ] Wiki와 Discussion | **Wiki**를 960 px, **Discussions**를 **Full width**로 설정한다. Wiki에서 **Focus**를 켰다가 끈다. | 두 탭이 서로 다른 너비를 유지한다. Wiki의 페이지 목록이 접혔다 돌아온다. | [Wiki](https://github.com/microsoft/TypeScript/wiki) · [Discussion](https://github.com/vercel/next.js/discussions/10640) |
| [ ] README와 Markdown | **README & Markdown**을 960 px에서 **Full width**로 바꾼다. | README 본문이 넓어진다. 저장소 홈에서 위쪽 파일 목록의 너비는 유지되고 본문이 오른쪽 사이드바와 겹치지 않는다. | [저장소 홈](https://github.com/microsoft/TypeScript) · [README 파일](https://github.com/microsoft/TypeScript/blob/main/README.md) |
| [ ] 비교와 커밋 | **Compare & commits**를 960 px로 설정한 뒤 **Use shared**로 되돌린다. | 비교 화면과 커밋 diff에 상한이 적용되고, 상속으로 돌아가면 설정된 PR 너비를 따른다. | [태그 비교](https://github.com/microsoft/TypeScript/compare/v5.8.2...v5.8.3) · [커밋](https://github.com/microsoft/TypeScript/commit/f6b94db) |
| [ ] 글자 크기와 설정 유지 | **Font size**를 20 px로 바꾼 뒤 이미 열려 있는 Issue와 Wiki를 보고 탭을 새로고침한다. | 두 탭의 본문에 변경이 반영되고 새로고침 후에도 유지된다. | [Issue](https://github.com/microsoft/TypeScript/issues/1) · [Wiki](https://github.com/microsoft/TypeScript/wiki) |

## 3. 로그인 후 편집 화면 확인

**Issues와 Wiki를 활성화한 테스트 저장소**를 사용한다. 아래 `BASE`를 쓰기 권한이 있는 저장소 주소로 바꾼다. 예를 들어 `https://github.com/OWNER/REPO`이다. 기존 Issue 번호와 Wiki 페이지명, 브랜치는 실제 값으로 바꾼다. 모든 편집 검사는 초안 상태에서 할 수 있다.

| 화면 | 열 URL 또는 진입 방법 |
| --- | --- |
| 새 Issue / 기존 Issue 본문·댓글 | `BASE/issues/new` · `BASE/issues/번호`에서 본문의 **… → Edit** 또는 댓글 입력창 |
| 새 Wiki / 기존 Wiki | `BASE/wiki/_new` · `BASE/wiki/Home/_edit` |
| 기존 Markdown 파일 | `BASE/edit/main/README.md` |

**Editor height**를 160 px로, **Side-by-side Markdown preview**를 켠다. 아래 내용을 초안에 붙여 넣는다. 스크롤을 시험할 때는 블록을 세 번 복사하고 제목의 A를 각각 B와 C로 바꾼다.

```markdown
## 구간 A

- [x] 완료한 작업
- [ ] 남은 작업

<details><summary>상세 보기</summary>

접힌 영역의 본문입니다.

</details>

| 항목 | 결과 |
| --- | --- |
| 미리보기 | 확인 중 |
```

- [ ] **편집 너비와 높이** — 새 Issue와 Wiki 편집 화면에서 해당 페이지 너비를 960 px → **Full width**, 높이를 160 → 320 px로 바꾼다. 열린 편집기에 즉시 반영되고 두 열이 같은 행에 놓이며 초안이 유지된다.
- [ ] **서버 렌더링 일치** — Issue와 Wiki에서 각각 입력을 멈추고 체크박스·접힌 상세·표를 확인한다. **Preview** 탭을 눌렀을 때도 같은 내용과 구조가 보인다. 서버가 정상인 상태에서 `Local preview`가 계속 표시되면 기록한다.
- [ ] **탭 왕복** — Issue와 Wiki에서 **Preview → Write**를 두 번 반복한다. 매번 오른쪽 미리보기가 하나만 복원되고, 돌아온 뒤 입력한 글자가 반영된다.
- [ ] **내용 기준 양방향 스크롤** — 높이를 160 px로 되돌린다. 원문에서 구간 B를 상단으로 올리면 오른쪽도 B 부근을 보여 준다. 이번에는 오른쪽에서 A로 돌아가 원문도 따라오는지 확인한다. 긴 문장을 넣고 창을 좁혀 줄바꿈이 달라진 뒤에도 반복한다.
- [ ] **Wiki 상대 링크** — 초안에 `[홈](Home)`을 추가한다. 사이드 미리보기에서 누르면 해당 저장소의 Wiki 홈이 새 탭에서 열리고 원래 탭에는 초안이 남는다.
- [ ] **편집기 간 간섭** — 기존 Issue의 본문 편집기와 댓글 입력창에 서로 다른 문구를 넣는다. 각 미리보기에는 자기 입력창의 문구만 표시된다.
- [ ] **Markdown 파일 편집** — 긴 README의 맨 아래에 고유한 제목을 추가한다. 원문을 맨 위로 올려도 미리보기 끝에 제목이 남아 있다. 사이드 미리보기를 끄면 기본 **Edit / Preview** 탭과 초안이 유지된다.
- [ ] **서버 실패 시 대체 표시** — Issue 편집 탭의 개발자 도구 → **Network**에서 **Offline**을 선택하고 초안을 수정한다. 오른쪽에 수정 내용과 `Local preview`가 보인다. **No throttling**으로 복구한 뒤 한 글자 더 입력하면 서버 결과가 돌아오고 안내가 사라진다.

## 4. 사내 GitHub Enterprise Server

검사한 호스트·서버 버전 __________　 실제 Issue URL __________　 실제 Wiki 편집 URL __________

- [ ] `https://사내호스트/조직/저장소/issues/번호`에서 팝업을 연다. 표시된 호스트가 실제 주소와 일치한다. **Enable on this site**를 누르고 권한을 허용하면 이미 열어 둔 탭에도 너비 설정이 반영된다.
- [ ] 같은 호스트의 Issue와 `https://사내호스트/조직/저장소/wiki/Home/_edit`에서 **서버 렌더링 일치**, **탭 왕복**, **양방향 스크롤**을 반복한다. 개발자 도구 **Network**에서 초안을 바꾼 직후의 Preview 요청이 해당 사내 호스트로 가는지 확인한다.
- [ ] **Disable on this site**를 누른다. 해당 호스트에서 사이드 미리보기와 확장의 너비 설정이 해제되고 새로고침 후에도 해제 상태가 유지된다. 열어 둔 GitHub.com 탭에서는 확장이 계속 동작한다.

## 5. 복원과 배포 판단

- [ ] 팝업의 확장 스위치를 껐다가 켠다. 끄면 원래 레이아웃이 돌아오고, 켜면 이전 너비·글자 크기·미리보기 설정이 다시 적용된다.
- [ ] 확장 관리 화면에서 **Refine GitHub 새로고침**을 누른 뒤 이미 열려 있는 Issue 탭에서 너비를 다시 바꾼다. 설정이 반영되고 미리보기 영역이 중복되지 않는다.
- [ ] 팝업의 **↺ Reset**을 누른다. 열려 있는 탭의 너비·글자 크기·편집기 높이가 기본값으로 돌아가고 Focus와 사이드 미리보기가 꺼진다.

**결과**　□ 통과　□ 수정 후 재확인　□ 일부 미검증

실패 또는 미검증 항목은 브라우저, URL, 조작 순서, 기대 결과, 실제 결과를 함께 기록한다.

| 항목 | 브라우저 / URL | 조작 순서 | 기대 결과 / 실제 결과 |
| --- | --- | --- | --- |
| | | | |
