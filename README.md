# 비트바이 설치 안내서

비트코인 실시간 시세, 김치 프리미엄, 최신 뉴스, 게시판, 실시간 채팅이 있는 사이트입니다.
아래 4단계를 순서대로 하면 `https://bitbuy.vercel.app` 같은 주소로 누구나 들어올 수 있어요.
**모두 무료**이고, 프로그램 설치는 필요 없어요. 웹 브라우저만 있으면 됩니다.

| 기능 | 동작 방식 |
|---|---|
| 실시간 시세 | 방문자 브라우저가 업비트·바이낸스에 직접 실시간 연결 |
| 차트 | `/api/candles` 가 업비트 5분봉을 가져옴 |
| 뉴스 | `/api/news` 가 구글 뉴스 '비트코인' 기사를 5분마다 모음 |
| 게시판·채팅·접속자 수 | Supabase (무료 데이터베이스) |

---

## 1단계. GitHub에 파일 올리기 (5분)

1. https://github.com 에 가입하고 로그인합니다.
2. 오른쪽 위 **+** → **New repository** 를 누릅니다.
3. Repository name에 `bitbuy` 를 입력하고 **Public** 을 선택한 뒤 **Create repository** 를 누릅니다.
4. 다음 화면에서 **uploading an existing file** 링크를 누릅니다.
5. 압축을 푼 `bitbuy` 폴더 **안의 내용물 전부**를 끌어다 놓습니다.
   (`api` 폴더, `index.html`, `app.js`, `style.css`, `config.js`, `package.json`, `supabase.sql`, `README.md`)
6. 아래 **Commit changes** 를 누릅니다.

> `api` 폴더도 꼭 같이 올라가야 뉴스와 차트가 나와요. 올린 뒤 목록에 `api` 폴더가 보이는지 확인하세요.

## 2단계. Supabase에서 데이터베이스 만들기 (5분)

1. https://supabase.com 에 GitHub 계정으로 가입합니다.
2. **New project** 를 누릅니다.
   - Name: `bitbuy`
   - Database Password: 아무 비밀번호나 정하고 **따로 적어 두세요.**
   - Region: **Northeast Asia (Seoul)**
3. 프로젝트가 만들어지면(1~2분) 왼쪽 메뉴 **SQL Editor** 를 누릅니다.
4. `supabase.sql` 파일 내용을 **전부 복사해서 붙여넣고** 오른쪽 아래 **Run** 을 누릅니다.
   `Success` 가 나오면 성공이에요.

## 3단계. 사이트와 데이터베이스 연결하기 (2분)

1. Supabase 왼쪽 아래 **Project Settings**(톱니바퀴) → **API** (또는 **API Keys**) 로 갑니다.
2. 두 가지를 복사합니다.
   - **Project URL** (`https://xxxx.supabase.co` 형태)
   - **anon public** 키 (또는 `sb_publishable_` 로 시작하는 **Publishable key**)
   - ⚠️ `service_role` / `secret` 키는 **절대** 쓰면 안 됩니다.
3. GitHub의 `bitbuy` 저장소에서 `config.js` 를 누르고, 오른쪽 위 **연필 아이콘(Edit)** 을 누릅니다.
4. 따옴표 안의 글자를 복사한 값으로 바꿉니다.
   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "복사한-키"
   ```
5. **Commit changes** 를 누릅니다.

## 4단계. Vercel로 인터넷에 공개하기 (3분)

1. https://vercel.com 에 **Continue with GitHub** 로 가입합니다. (Hobby, 무료 선택)
2. **Add New… → Project** 를 누르고, 목록에서 `bitbuy` 옆 **Import** 를 누릅니다.
3. **Project Name** 이 `bitbuy` 인지 확인합니다. 다른 설정은 건드리지 않아도 돼요.
4. **Deploy** 를 누르면 1분 안에 완성됩니다. 🎉

주소는 보통 `https://bitbuy.vercel.app` 이 됩니다.
**누군가 이미 그 이름을 쓰고 있으면** Vercel이 `bitbuy-xxxx.vercel.app` 처럼 다른 주소를 줘요.
이 경우 Vercel 프로젝트 **Settings → Domains** 에서 `bitbuy-kr.vercel.app` 처럼 비어 있는 이름으로 바꿀 수 있어요.

앞으로 GitHub에서 파일을 고치면 Vercel이 **자동으로 다시 배포**합니다.

---

## 운영 방법

- **글·댓글·채팅 삭제**: Supabase → **Table Editor** → `posts` / `comments` / `chat` 에서 줄을 선택하고 삭제합니다.
  (글을 지우면 그 글의 댓글도 같이 지워져요.)
- 방문자는 글을 **쓰고 추천만** 할 수 있고, 수정·삭제는 관리자만 할 수 있게 막아 뒀어요.
- 채팅은 최근 2,000개만 남기고 오래된 것부터 자동으로 지워집니다.

## 꼭 알아 둘 점

- **Supabase 무료 프로젝트는 1주일 동안 아무도 쓰지 않으면 일시정지**돼요. 대시보드에서 **Restore** 를 누르면 다시 켜집니다.
- 로그인 없이 닉네임만으로 쓰는 방식이라 **다른 사람이 같은 닉네임을 쓸 수 있어요.** 방문자가 많아지면 회원가입(Supabase Auth)을 붙이는 걸 추천해요.
- 도배 방지는 화면에서만 걸려 있어요(채팅 2초, 글 30초). 악용이 생기면 서버 쪽 제한을 추가해야 해요.
- 가상자산 커뮤니티는 **투자 권유, 리딩방 홍보, 유사투자자문** 게시물을 조심해야 해요. 이런 글은 빨리 지우고, 이용 규칙을 공지로 올려 두세요.
- 업비트·바이낸스 연결이 막히는 환경(일부 회사망 등)에서는 시세가 안 보일 수 있어요.

## 파일 구성

```
bitbuy/
├─ index.html      화면 뼈대
├─ style.css       디자인 (상승 빨강 / 하락 파랑)
├─ app.js          시세·차트·뉴스·게시판·채팅 동작
├─ config.js       ← Supabase 주소와 키를 넣는 곳 (3단계)
├─ api/
│  ├─ news.js      뉴스 수집 서버 함수
│  └─ candles.js   차트 데이터 서버 함수
├─ supabase.sql    데이터베이스 설정 (2단계)
└─ package.json
```
