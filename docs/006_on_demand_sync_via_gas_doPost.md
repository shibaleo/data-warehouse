# On-Demand Sync via GAS doPost (計画)

> Status: GAS 側実装済 (2026-06-24)。CF Worker route と data-drills UI が残作業。
> 起票は 2026-06-23、Worker proxy 採用は同日確定。

## 目的

ブラウザ (data-drills) から「今すぐ同期」ボタンを押した時に、CF Worker 経由で
GAS の sync ジョブをオンデマンド起動できるようにする。現状は time-based trigger
(togglHourlySync / dailySync / dailySyncGoogleHealth / notionAllSync /
togglWeeklyHistoricalSync) のみで、即時性が無い。

### ユースケース

- Toggl で時間記録した直後、digest を最新に保ちたい
- 運動 / 余暇など、日中に複数回更新がある source の即時反映
- 「sync が遅れてる」と気付いた時の手動 kick

## 設計原則: sync logic は GAS に集約

「data-drills の sync ボタン」を実装するときに、sync logic を CF Worker 側に
書く道もあったが、以下の理由で **sync 本体は GAS、caller は薄い** という分担に
した:

- **GAS は warehouse 書き込み権限 + upstream API token を既に持つ唯一の実行環境**。
  これを各 caller (CF Worker / 将来の別ランタイム / mobile app / 手動 trigger) に
  分散させると、認証情報と接続先が増えて運用が散る
- **このアプリ (data-drills SPA) は将来別ランタイム (例: 別 backend, MCP server,
  CLI) からも触られる可能性がある**。sync 起動 API が GAS doPost に統一されて
  いれば、各ランタイムは fetch するだけで良い
- **on-demand sync と time-based sync が同じ関数を呼ぶ**ことで、incremental
  ロジック / dedup / Lock のすべてが一本化される (2 重実装の drift 防止)

CF Worker proxy はあくまで「ブラウザの認証 token を GAS まで届けるための薄い
中継」として位置づけ、sync ロジックを持たない。

## ジョブ分類と適切な実行基盤

このドキュメントは中段に該当する「on-demand short」のみを対象にする。

```
ジョブ性質              実行基盤             所要時間目安      備考
──────────────────────────────────────────────────────────────────
hourly batch (定常)     GAS time-based       1〜数分           現状維持
on-demand short         CF Worker → GAS      30s〜3min        ← 本書
backfill / 数十分超え    Lambda / Cloud Run   分〜時間          将来必要なら
```

CF Worker の wall clock 上限 (paid: 5min) は **「これ以上長いものは Worker に
乗せるな」という contract** として積極的に活用する。timeout error が出たら、
その sync は短くするか、Lambda 等に逃がすかの判断シグナル。

## リクエスト経路

```
ブラウザ (data-drills SPA)
    │ Clerk JWT (Authorization: Bearer ...)
    │ POST /api/v1/warehouse/sync, body: { target }
    ▼
CF Worker (data-drills)
    │ 既存の authenticate middleware で JWT 検証
    │ 同じ Clerk JWT を GAS に転送
    ▼
GAS Web App doPost
    │ Authorization header から JWT 取り出し、Clerk JWKS で検証
    │ 対応する sync 関数を invoke (togglHourlySync 等)
    │ 完了まで同期で待つ (30s〜3min)
    ▼
JSON response { ok: true, target, synced: N, durationMs }
    │
    ▼
CF Worker → ブラウザに返す
    │
    ▼
ブラウザは TanStack Query invalidate して再 fetch
```

## アーキテクチャ判断: なぜ Worker proxy 経由か

「ブラウザ → GAS 直」も実装上は可能だが、以下の理由で Worker proxy を採用:

| 観点 | Worker proxy | ブラウザ → GAS 直 |
|---|---|---|
| API surface 一貫性 | ◎ 全 data ops が `/api/v1/*` に統一 | × warehouse sync だけ外部 URL 直叩きで例外 |
| timeout を安全装置として効かせる | ◎ Worker wall clock で fail-fast | × ブラウザは無音で長時間待ち |
| CORS | ◎ 不要 | △ GAS preflight 制約 (text/plain workaround) |
| deploy 独立性 | ◎ GAS URL 変更は wrangler env のみ | × SPA 再ビルド必要 |
| sync 履歴ログ | △ Neon raw_* の revision に既にある (Worker で追加ログ不要) | △ 同左 |
| latency | △ 1 hop ぶん +50〜200ms | ◎ 直接 |
| コード surface | △ Worker route 30 行ぶん追加 | ◎ ブラウザ fetch 1 行 |

「sync 履歴は warehouse 側に SSOT として残ってる」ので Worker でログする
必要は無い (この点は browser 直の equality でもある)。決め手は **API 一貫性 +
timeout を anti-foot-gun として効かせる** の 2 点。

## 認証方針: Clerk JWT pass-through

新規シークレットを増やさず、既存の Clerk identity を data-warehouse 側まで貫通させる。

### CF Worker 側

- 既に Clerk middleware で JWT を検証済 (Hono の `authenticate` で `c.req.raw` から token 抽出)
- そのまま `Authorization: Bearer <jwt>` ヘッダで GAS にプロキシ転送するだけ

### GAS 側 (新規実装)

doPost handler の入口で:

1. body の `auth_token` フィールドから JWT を取り出す (GAS Web App は header を
   細かく扱えないので body 経由が確実)
2. Clerk JWKS endpoint (`https://<clerk-domain>/.well-known/jwks.json`) を
   `UrlFetchApp.fetch` で取得
3. JWT header の `kid` で対応する公開鍵を選択
4. RSA-SHA256 で署名検証 + `exp` / `iss` / `aud` claim チェック
5. OK なら sync 関数 dispatch、NG なら 401

### 実装ポイント

- **JWKS キャッシュ**: `CacheService.getScriptCache()` で 1 時間キャッシュ。
  検証失敗時は cache を破棄して再 fetch (Clerk の key rotation 対応)
- **JWT decode**: GAS 標準で base64url decode + JSON parse は自前。
  RSA 検証は `Utilities.computeRsaSha256Signature` を使う
- **expiration**: Clerk JWT は短命 (1 分)。ブラウザ起点なら問題なし。
  バックグラウンド job 用途では別途検討

### なぜ共有シークレットや URL secret を採用しないか

| 方式 | 不採用理由 |
|---|---|
| 共有シークレット (env var) | 環境変数を 3 箇所 (drills repo / wrangler / GAS Properties) に同期する運用負担 |
| GAS URL を secret 扱い | security through obscurity。URL leak で守れない |
| Google IAP / Workspace 制限 | CF Worker は Google identity を持たないので caller 側で立証できない |

Clerk JWT 方式なら user identity が warehouse 側にも届く副次効果あり。

## GAS Web App 設定

- 公開範囲: `Anyone, even anonymous` (実体は JWT で守る)
- 実行アカウント: `Me` (固定。upstream API トークンは現状通り DB から読む)
- deploy 単位: `/exec` URL を CF Worker の env に登録 (`WAREHOUSE_SYNC_URL`)
  - URL は `wrangler.toml` の vars に入れる (secret ではないので問題なし)
- `clasp deploy` で新 version を作るたびに /exec URL は据え置きになる
  (versioned deploy を選んでいる限り)。新規 URL になるのは初回 deploy のみ

## CF Worker 側の新規エンドポイント

```
POST /api/v1/warehouse/sync
Authorization: Bearer <clerk_jwt>  (← Hono middleware が検証済)
Body: { target: "toggl" | "google_health" | "notion" | ... }
```

擬似コード:

```ts
// src/routes/warehouse.ts
const syncInputSchema = z.object({
  target: z.enum(["toggl", "google_health", "notion", "zaim", "tanita"]),
});

app.post("/sync", zValidator("json", syncInputSchema), async (c) => {
  const { target } = c.req.valid("json");
  const jwt = c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!jwt) return c.json({ error: "missing jwt" }, 401);

  const r = await fetch(env.WAREHOUSE_SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth_token: jwt, target }),
  });
  const body = await r.json();
  return c.json(body, r.status);
});
```

- timeout: 既定で fetch は最後まで待つ。CF Workers の wall clock 上限が壁。
  paid plan なら 5min まで持つ。これを超えるなら Lambda 検討シグナル

## 長尺ジョブの移行ガイドライン

CF Worker → GAS の経路が機能しなくなる条件と、その時の選択肢:

### Worker timeout に当たり始めた時

- まず GAS 側の sync ロジックを inspect。incremental になっているか確認
  (例: Toggl は last_synced_at 以降のみ取る等)
- それでも長い場合 = on-demand 用途には不適。time-based trigger 側に任せる

### GAS の 6 分実行上限を超え始めた時

- 該当 source の sync を Cloud Run / Lambda に移行
- Cloud Run: Docker 化して GCP に push、HTTPS endpoint 生やす。CF Worker から
  fetch する形は同じ (signed URL / OIDC 等で auth)
- Lambda: 既存の `services/pdf-lambda/` が参考になる。AWS SigV4 で CF Worker
  から invoke する pattern を流用可能
- 同期返しの timeout 問題は変わらないので、長尺 = fire-and-forget + polling に
  設計切り替え。job_id 発行 → 別 endpoint で進捗確認

## 未解決事項

### 1. 同時実行の重複防止

「sync now」連打で togglHourlySync が 2 つ並走するとレース。GAS の `LockService`
で sync 関数全体を mutex 化する。2 つめは「既に実行中」を即返す。

### 2. 進捗フィードバック

同期返しで `{ synced: N, durationMs }` を返すだけで良いか、それとも詳細
(各 source の counts) を返すか。最小は前者。

### 3. 失敗時の挙動

GAS の sync が部分失敗 (一部 source は成功、一部は失敗) した時のレスポンス形状。
ステータスコード分け + body に warnings 配列。

### 4. data-drills 側の UI

manual sync ボタンを digest ヘッダに追加。実装は既存 `<ManualSyncButton>`
コンポーネントを再利用可能。loading 中はスピナー、完了で toast + invalidate。

## 実装順序

1. ✅ GAS 側に Clerk JWKS 検証ヘルパー (`apps/connector/src/lib/auth.ts`)
   - V8 BigInt で RSASSA-PKCS1-v1_5 (RS256) を pure-JS 実装
   - `Utilities.computeRsaSha256Signature` は **sign 専用** で verify 不可だったため pure-JS で対応
   - JWKS は `CacheService.getScriptCache()` で 1h cache、署名失敗時は cache 破棄して 1 回再 fetch
2. ✅ GAS doPost handler (`apps/connector/src/web.ts`)
   - target dispatch: toggl / google_health / notion / zaim / tanita
   - `LockService.getScriptLock()` で同時実行防止 (重複は即座に `ok: false` で返す)
   - GAS Web App は HTTP status code を任意設定できないため、すべて 200 で `ok` フィールドで分岐
   - `appsscript.json` に `webapp.access=ANYONE_ANONYMOUS / executeAs=USER_DEPLOYING` を設定
3. ⏳ `clasp push` + `clasp deploy` で `/exec` URL 発行、CF Worker の env に登録
   - Script Properties に `CLERK_JWKS_URL`、`CLERK_ISSUER`、(任意で) `CLERK_AUDIENCE` を設定すること
4. ⏳ CF Worker 側 (data-drills repo) に `/api/v1/warehouse/sync` 追加
5. ⏳ data-drills の digest ヘッダに manual sync ボタン
6. ⏳ Toggl で動作確認 → 他 source 展開

## 参考

- 既存 trigger 定義: `apps/connector/src/main.ts` の `ScriptApp.newTrigger(...)` 群
- Clerk JWKS: `https://<your-clerk-frontend-api>/.well-known/jwks.json`
  - data-drills の `.env` に Clerk frontend API URL があるはず
- 既存 Lambda 参考: data-drills の `services/pdf-lambda/` (AWS SigV4 で CF Worker
  から invoke する pattern)
