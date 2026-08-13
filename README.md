# 嚐記 TASTELOG

手機優先的餐廳回憶與朋友同桌評分網站。產品規則與技術決策以 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) 為準。

## 目前實作狀態

第一個 React 切片已完成，可在不設定雲端帳號的情況下操作：

- React + TypeScript + Vite 專案骨架
- Humation 共用 Avatar（個人頭像、多人半身、固定式表情評分角色）
- 單頁評分流程與依分數變化的精簡詞條
- 動態菜色列：短按切換、長按滑動預覽、明細與快速新增入口
- 本桌明細 bottom sheet、拖曳／按鈕排序
- 手動快速新增與待確認鎖定
- 沒吃到／有吃但略過，以及可復原提示
- 整體用餐鎖定規則
- 本機草稿保存
- 單次拉幕結果揭曉、個人評分明細與餐廳歷史排行
- 不可變結果版本、已看過狀態與跨次 canonical dish 資料契約
- Supabase schema、RLS 與 Gemini 菜單辨識 Edge Function 骨架

Google-only 登入、受邀名單、正式 Supabase 餐桌資料與 Realtime 多人同步均已接線。Gemini 菜單辨識目前保留為未來功能。

## 本機執行

```powershell
npm install
npm run dev
```

開啟 <http://127.0.0.1:4173/>。

驗證正式建置：

```powershell
npm run typecheck
npm run build
```

## 目錄

- `src/components/`：共用 React UI 元件
- `src/data/`：demo 資料與評分詞條規則
- `src/lib/supabase.ts`：Supabase client 入口；未設定環境變數時保持停用
- `src/lib/resultRepository.ts`：Ready、結果版本、已看過狀態與餐廳歷史榜的資料介面
- `supabase/migrations/`：正式資料表、Realtime 與 RLS 權限
- `supabase/functions/menu-ocr/`：不保存原圖的 Gemini 菜單辨識函式
- `app.js`、`styles.css`：遷移前的原型程式與樣式，只作視覺／互動參考
- `design-system/default/MASTER.md`：UI/UX skill 產生的檢查基準；既有品牌風格優先

## 尚未需要你設定的帳號

目前設定進度：

1. Supabase 專案與四份 schema migration：已完成
2. Google OAuth、受邀名單與本機登入：已完成，首位 Admin profile 與權限已驗證
3. Gemini API key：尚未設定
4. GitHub Pages workflow：已建立；尚待建立 GitHub repository、設定兩個 Actions secrets 並首次推送

好友封測部署步驟請見 [FRIEND_BETA_DEPLOY.md](./FRIEND_BETA_DEPLOY.md)。

屆時只需由帳號擁有者完成必要授權；其餘資料表、權限與部署設定由開發流程處理。
