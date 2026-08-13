# 好友封測上線設定

部署檔已放在 `.github/workflows/deploy-pages.yml`。推送到 GitHub 的 `main` 分支後，GitHub Actions 會自動建置並發布網站。

## 一次性設定

1. 在 GitHub 建立一個空 repository，建議名稱 `food-web`，不要勾選自動建立 README。
2. Repository → **Settings → Secrets and variables → Actions → New repository secret**，建立：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Repository → **Settings → Pages → Build and deployment → Source**，選擇 **GitHub Actions**。
4. 將本機專案推送到 `main`。完成後網址通常會是：
   `https://<GitHub帳號>.github.io/food-web/`

## 網站第一次發布後

將完整 GitHub Pages 網址（結尾保留 `/`）加入：

- Supabase → Authentication → URL Configuration
  - Site URL
  - Redirect URLs
- Google Cloud → OAuth Client → Authorized JavaScript origins
  - 只填 origin，例如 `https://<GitHub帳號>.github.io`
- Google Cloud → OAuth Client → Authorized redirect URIs
  - 保留 Supabase 提供的 callback URL，不是 GitHub Pages 網址

## 朋友如何出現在同桌

1. Admin 先把朋友的 Gmail 加進 Supabase `allowlist`。
2. 朋友用該 Gmail 登入網站一次，系統才會建立他的 profile。
3. 朋友從主頁點同一個「進行中的餐桌」。加入後，所有人的角色與評分進度會即時出現在同桌畫面。

`allowlist` 範例：

```sql
insert into public.allowlist (email, active, is_admin, added_by)
values ('friend@gmail.com', true, false, auth.uid())
on conflict (email) do update
set active = true;
```

目前封測不需要房間碼；沒有實際加入該桌的好友，不會被計入評分人數。
