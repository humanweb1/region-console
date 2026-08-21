# Region Console

Region Console; bölge/alan yönetimi, geçmiş, kampanya ve alt kullanıcı yönetimi için sade bir foundation üzerine kuruludur.

## Tamamlanan çekirdek özellikler

- Supabase email/password login ve password recovery
- Gerçek Leaflet polygon çizimi: tıklayarak nokta ekle, çift tıklayarak bitir, Escape ile iptal
- Özel alanların GeoJSON benzeri koordinat yapısıyla kaydedilmesi
- Alan durumu: hizmet verilen / hizmet dışı
- Buluta kayıt ve geri yükleme
- Undo / redo ve son 50 değişiklik geçmişi
- JSON import / export
- Kampanya oluşturma ve cloud state içinde saklama
- Responsive map shell ve mobil layout
- Yönetici tarafından güvenli alt kullanıcı daveti için Supabase Edge Function
- Profil tabanlı admin / sub_user / viewer rol modeli ve RLS

## Çalıştırma

```bash
npm install
npm run check
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Supabase kurulumu

### 1. Migration

Supabase SQL Editor'da veya Supabase CLI ile:

```bash
supabase db push
```

Migration:

```text
supabase/migrations/001_profiles.sql
```

Bu migration `profiles` tablosunu, rol fonksiyonlarını ve `region_console_state` için rol bazlı RLS'i oluşturur.

### 2. İlk admin

Migration sonrasında SQL Editor'da kendi hesabınızı admin yapın:

```sql
update public.profiles
set role = 'admin'
where email = 'SIZIN_ADMIN_EMAILINIZ';
```

### 3. Alt kullanıcı daveti

Fonksiyon:

```text
supabase/functions/invite-user/index.ts
```

Deploy:

```bash
supabase functions deploy invite-user
```

Function'ın server ortamında Supabase secret/service-role credential kullanması gerekir. Bu credential hiçbir şekilde frontend'e konmaz.

İsteğe bağlı site URL secret'ı:

```bash
supabase secrets set REGION_CONSOLE_SITE_URL=http://localhost:8787
```

Production'da bunu gerçek uygulama URL'si ile değiştirin ve Supabase Auth Redirect URLs listesine ekleyin.

### 4. Runtime config

`src/core/runtime-config.js` yalnızca publishable key içerir. Service-role/secret key tarayıcıya konmaz.

## Test planı

### A. Static check

```bash
npm run check
```

Beklenen:

```text
komut 0 exit code ile tamamlanmalı
```

### B. Login

1. `npm run dev`
2. `http://localhost:8787` açın.
3. Geçerli Supabase hesabıyla giriş yapın.
4. Login ekranı kaybolmalı ve console görünmeli.
5. Console'da harita görünmeli.

### C. Polygon

1. `Çizim Aracı` seçin.
2. Haritada en az 3 noktaya tıklayın.
3. Çift tıklayın.
4. `Kaydet` tıklayın.
5. Alan haritada kalmalı.
6. Sayfa yenilenince alan tekrar yüklenmeli.

### D. Undo / redo

1. Bir alan kaydedin.
2. `Geri al` tıklayın: alan kaybolmalı.
3. `İleri al` tıklayın: alan geri gelmeli.
4. Sayfa yenileyip sonucu doğrulayın.

### E. Geçmiş

`Geçmiş` → değişiklik listesinin görünmesi gerekir.

### F. Import / export

1. `Dışa Aktar` ile JSON indirin.
2. `İçe Aktar` ile aynı dosyayı tekrar seçin.
3. Veri korunmalı.

### G. Kampanyalar

`Kampanyalar` → `Yeni kampanya` → ad/açıklama girin.

Sayfa yenilendikten sonra kampanya yine görünmeli.

### H. Alt kullanıcı

Önce migration + admin rolü + Edge Function deploy tamamlanmalı.

Sonra:

1. `Alt kullanıcı` tıklayın.
2. Ad/e-posta/rol girin.
3. Davet gönderin.
4. Davet maili gelmeli.
5. Viewer hesap veri okuyabilmeli ancak `region_console_state` üzerinde yazma işlemi RLS tarafından reddedilmeli.
6. Admin/sub_user yazma işlemi yapabilmeli.

## Mimari

```text
src/
├── core/
│   ├── app.js
│   └── config.js
├── state/
│   └── store.js
├── services/
│   ├── auth.js
│   └── cloud.js
├── components/
│   └── shell.js
├── features/
│   ├── auth/
│   ├── map/
│   ├── regions/
│   ├── drawing/
│   └── ui/
├── styles/
│   └── *.css
└── supabase/
    ├── migrations/001_profiles.sql
    └── functions/invite-user/index.ts
```

## Güvenlik

Supabase Auth kullanıcı verisi ve yetkilendirme için frontend `user_metadata` alanına güvenilmez. Rol kontrolü `public.profiles` + RLS + server-side Edge Function üzerinden yapılır. Supabase'in resmi dokümantasyonu da `user_metadata` değerlerine güvenlik açısından yetki kaynağı olarak güvenilmemesini ve RLS kullanılmasını önerir.
