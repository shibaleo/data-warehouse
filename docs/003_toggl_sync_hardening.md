# Toggl sync の堅牢化

作成日: 2026-06-15

## 背景

data-drills 側で habit done 判定を `data_presentation.fct_toggl_time_entries` への
JOIN で実装するにあたり、Toggl sync 経路の信頼性を上げる必要が出てきた。
具体的には以下 2 つの failure mode が現状コードでガードされていない:

1. **`since` 計算失敗時のフォールバックが暗黙の全期間取得になっている可能性**
   - `since` が未設定で API を叩くと Toggl は workspace 作成以降の全 entries を
     返しうる。1 sync 内で pagination が暴発し、user-level quota
     (30 req/h/user, 2025-09-05 enforce) を 1 回で食い潰す危険
2. **HTTP 402 (quota exceeded) のハンドリングが retry path に流れている可能性**
   - 402 を 5xx 系と同じ扱いで retry すると、quota 復帰を待たずに再叩きして
     悪化させる。402 は **wait + skip**、次 trigger に任せるのが正

加えて、data-drills の Worker から **on-demand な手動同期ボタン** を提供する
ため、`fct_toggl_time_entries.synced_at` を起点に Worker が直接 Toggl を
fetch する read-only path が増える。canonical writer (GAS) と非 writer reader
(Worker) の責務分離を保ったまま堅牢性を上げる。

## 修正対象

`apps/connector/src/` の Toggl sync 関連:

- `togglHourlySync` — 1h trigger、1d 窓の time_entries 差分取得
- `dailySync` 内の Toggl 呼び出し — 3d 窓の整合性確認 + masters
- `togglWeeklyHistoricalSync` — 週次 Reports API

## 修正項目

### 1. `since` の堅牢化

**現状想定**: 最終 sync 時刻を Script Properties or DB から取得し、`since` に渡す。
取得失敗時の挙動が不明。

**修正方針**:

- `since` が確定できない場合は **skip + log**。フォールバックで全期間取得しない。
- `since` 値は **`now - 24h` を下限としてクランプ** する。極端に古い値が
  Properties に入っていても 24h 窓で頭打ちにし、pagination を予防。
- pagination が必要な response (1000 件超) を観測した場合は **warning log**。
  通常運用では発生しないはずなので、出たら異常検知のシグナルとする。

擬似コード:

```ts
function computeSince(): number | null {
  const raw = PropertiesService.getScriptProperties().getProperty('toggl_last_sync_at');
  if (!raw) {
    log('toggl_last_sync_at missing, skipping sync');
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    log(`toggl_last_sync_at invalid: ${raw}, skipping sync`);
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const floor = now - 24 * 3600;
  return Math.max(parsed, floor);
}

function togglHourlySync(): void {
  const since = computeSince();
  if (since === null) return;
  // ...
}
```

### 2. HTTP 402 ハンドリング

**現状想定**: HTTP error は共通 retry path に流れている可能性。

**修正方針**:

- 402 は **retry しない**。当該 sync 関数を即 return。
- 402 出現を Script Properties のカウンタ (`toggl_402_count`) に積み、
  `dailySync` の冒頭でカウントをログ + リセット。週次の運用確認で見える化。
- 5xx は従来通り retry 対象。

擬似コード:

```ts
function fetchTogglTimeEntries(since: number): TogglEntry[] | null {
  const res = UrlFetchApp.fetch(url, { ...opts, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 402) {
    incrementCounter('toggl_402_count');
    log('Toggl quota exceeded (402), skipping');
    return null;
  }
  if (code >= 500) throw new Error(`Toggl 5xx: ${code}`); // 既存 retry へ
  if (code >= 400) throw new Error(`Toggl 4xx: ${code} ${res.getContentText()}`);
  return JSON.parse(res.getContentText());
}
```

### 3. pagination 検出

**現状想定**: `/me/time_entries` のレスポンス長を見ていない。

**修正方針**:

- response が 1000 件 (Toggl 既定 page size) に達したら warning log。
- 通常 1h 窓では 5〜10 件、24h でも数十件のはずなので、1000 件は
  「`since` が壊れている」「GAS が長期停止していた」のシグナル。
- 当面は log のみで自動 pagination は実装しない。手動で原因究明する運用。

### 4. last sync 時刻の信頼源を `synced_at` に揃える

**現状想定**: Script Properties で `toggl_last_sync_at` を管理。
DB 側の `synced_at` と乖離する可能性。

**修正方針**:

- sync 成功時、Script Properties と DB 側双方を更新する既存ロジックを温存
- ただし起点として参照するのは **Script Properties** のまま (GAS 自身が
  単一 writer のため)
- Worker 側 on-demand sync は **`max(presentation.synced_at)`** を参照
  (DB が canonical な公開境界)

## Worker 側 on-demand sync の責務分離 (data-drills repo)

ここは data-warehouse 側の変更ではないが、設計の前提として明記:

- Worker は `presentation.fct_toggl_time_entries` を read-only で参照
- 手動ボタン押下時のみ、Worker が Toggl `/me/time_entries?since=X` を **1 req** 叩く
  - `X = min(max(presentation.synced_at), now - 24h)` で頭打ち
  - 結果は warehouse には書かず、JSON で client に返す
  - client 側で warehouse 由来 done と fresh delta を union 描画
  - 次の GAS hourly が走った時点で delta は warehouse に取り込まれ overlay 自然消滅
- secret: Toggl token は GAS と Worker で別 token (read-only スコープで Worker 用を発行)
  - GAS 側 token が漏れても Worker 経路には波及しない
  - quota は token 単位なので独立カウント

→ writer は GAS のみで append-only 整合性は維持、Worker は ephemeral reader
としてのみ振る舞う。

## 実装順序

1. **`since` クランプ + skip-on-missing** (本ドキュメント §1) — 最優先、pagination 暴発の保険
2. **402 ハンドリング** (§2) — quota 増加局面で必要
3. **pagination warning log** (§3) — モニタリング
4. **on-demand sync の Worker 実装** — 別 repo (data-drills) で着手

## 検証項目

- [ ] Script Properties の `toggl_last_sync_at` を空にして `togglHourlySync` 手動実行
      → log に "skipping sync" が出て fetch しないことを確認
- [ ] Script Properties に意図的に古い epoch (`1577836800` = 2020-01-01 等) を入れて
      `togglHourlySync` 実行 → fetch 窓が直近 24h にクランプされることを確認
- [ ] 402 を mock 注入して `toggl_402_count` がインクリメントされることを確認
- [ ] 通常運用で `appended=0` / `tombstoned=0` の比率が変わらないことを 1 週間観測

## 参考

- [001_append_only_redesign.md](./001_append_only_redesign.md) — 単一 writer 前提の根拠
- [Toggl API & Webhook limits](https://support.toggl.com/en/articles/11484112-api-webhook-limits-are-changing) — 30 req/h/user (2025-09-05 enforce)
- [Toggl FAQs about API limits](https://support.toggl.com/en/articles/11623558-faqs-about-api-limits) — 402 status semantics
