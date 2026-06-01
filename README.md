# LINE 打卡系統

一間店使用的手機打卡系統。員工從 LINE 開啟 LIFF 頁面，上班和下班打卡時會檢查 GPS 範圍，資料寫入 Google Sheet，並依班別容許時間自動計算工時與預估薪資。

## 第一版功能

- LINE LIFF 身份辨識
- 本機測試模式，不設定 LIFF 和 Apps Script 也能先測流程
- 管理者設定店址、允許打卡範圍、管理 PIN
- 班別設定：上班時間、下班時間、容許分鐘、休息分鐘
- 員工設定：姓名、時薪、LINE User ID
- 打卡判斷：準時、提早、遲到、早退、延後
- GPS 判斷：範圍內、超出範圍、定位失敗
- Google Sheet 儲存：打卡明細與每日出勤彙總
- 手機管理頁查看紀錄、匯出 CSV

## 容許時間規則

例如早班上班時間是 `06:30`，上班容許分鐘是 `15`：

- `06:15` 到 `06:45` 打卡都算準時
- 這段時間內的計算上班時間都會固定為 `06:30`
- `06:46` 之後算遲到，計算時間用實際打卡時間
- `06:14` 以前算提早，計算時間仍用 `06:30`

下班時間也同樣使用容許分鐘：

- 容許範圍內下班，計算下班時間固定為排定下班時間
- 太早下班算早退，計算時間用實際下班時間
- 超過容許時間後下班算延後，計算時間用實際下班時間

## 檔案

- `index.html`：LIFF 手機前端，可直接本機開啟測試
- `google-apps-script/Code.gs`：Google Apps Script 後端

## 目前已建立的網址

- GitHub Repo: <https://github.com/game1060430-star/line-clock-in-system>
- 前端網站: <https://game1060430-star.github.io/line-clock-in-system/>
- Google Sheet: <https://docs.google.com/spreadsheets/d/19w7HghXXignqEb653WOu4atkyUhsQ2t5qsJhC9FGaY4/edit>

## Google Sheet 設定

1. 建立一個新的 Google Sheet。
2. 點選 `擴充功能` -> `Apps Script`。
3. 將 `google-apps-script/Code.gs` 的內容貼到 Apps Script 編輯器。
4. 儲存專案。
5. 在 Apps Script 執行一次 `setup`，同意權限。
6. 回到 Google Sheet，應該會看到這些工作表：
   - `設定`
   - `員工`
   - `班別`
   - `打卡明細`
   - `每日出勤`

## Apps Script 部署

1. 在 Apps Script 點 `部署` -> `新增部署作業`。
2. 類型選 `網頁應用程式`。
3. 執行身分選 `我`。
4. 存取權限選 `任何人`。
5. 部署後複製 Web App URL。
6. 打開 `index.html`，到 `設定`，貼上 `Google Apps Script URL`。

目前已部署的 Apps Script URL：

```text
https://script.google.com/macros/s/AKfycbwDDO0NF5msB2B3KBDvMkPpGN1EDD2hz8cEvKZGxrgOm_QECebVkUlHxnmo6D9_FsTx0w/exec
```

## LINE LIFF 設定

1. 到 LINE Developers 建立 Provider 和 LINE Login Channel。
2. 在 Channel 的 LIFF 分頁新增 LIFF App。
3. Endpoint URL 填你的前端網址。
4. Scopes 至少勾選 `profile`。
5. 複製 LIFF ID。
6. 打開前端 `設定`，填入 LIFF ID。
7. 重新整理頁面，從 LINE 內開啟測試。

## 前端部署

測試時可以直接開 `index.html`。正式 LIFF 需要 HTTPS 網址，可以部署到：

- Vercel
- Netlify
- GitHub Pages
- 其他可提供 HTTPS 靜態網頁的平台

## 管理 PIN

預設 PIN 是 `1234`。正式使用前請先在 `設定` 修改。

## 員工綁定 LINE

第一版先提供手動綁定：

1. 員工從 LINE 開啟頁面。
2. 管理者可從 LINE Profile 或測試資料取得該員工的 LINE User ID。
3. 在 `員工` 頁新增或修改員工資料時填入 LINE User ID。

下一版可以再加「員工第一次進入時送出綁定申請，管理者審核」。

## 注意事項

- GPS 只能降低代打卡風險，無法做到絕對防作弊。
- Google Apps Script Web App 設為任何人可存取時，前端才容易呼叫；正式版若要更安全，應加上後端 token 或管理員白名單。
- 本機測試資料存在瀏覽器 localStorage，不會自動同步到 Google Sheet。
