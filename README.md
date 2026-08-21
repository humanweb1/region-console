# Region Console

Temiz başlangıç mimarisi. Eski v2.x fix/recovery/guard dosyaları bu projeye taşınmaz.

## İlkeler

- Tek uygulama başlangıç noktası: `src/core/app.js`
- Tek global state: `src/state/store.js`
- Auth yalnızca `src/services/auth.js`
- Supabase veri erişimi yalnızca `src/services/cloud.js`
- Harita yalnızca `src/features/map/`
- Bölge hiyerarşisi yalnızca `src/features/regions/`
- Çizim yalnızca `src/features/drawing/`
- UI katmanı veri erişiminden bağımsız
- CSS override zinciri yok; her bileşenin tek ana geometrisi var.
- LocalStorage ana veri deposu değildir. Yalnızca küçük UI tercihleri için kullanılabilir.
- Hata durumları görünür ve tekil tutulur.

## Çalıştırma

```bash
npm install
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Supabase

`src/core/config.js` içindeki public URL/key değerlerini kendi projenizle değiştirin veya uygulama açılmadan önce `window.REGION_CONSOLE_CONFIG` sağlayın.

Tarayıcıya service-role key koymayın.

## Mimari

```text
src/
├── core/
│   ├── app.js              # tek bootstrap
│   └── config.js           # runtime config
├── state/
│   └── store.js            # tek state kaynağı
├── services/
│   ├── auth.js             # Supabase Auth
│   └── cloud.js            # Supabase REST
├── components/
│   └── shell.js            # sabit uygulama kabuğu
├── features/
│   ├── auth/
│   │   └── login.js
│   ├── map/
│   │   └── map.js
│   ├── regions/
│   │   └── regions.js
│   ├── drawing/
│   │   └── drawing.js
│   └── ui/
│       └── panels.js
└── styles/
    ├── base.css
    ├── shell.css
    ├── sidebar.css
    ├── map.css
    └── panels.css
```

Bu sürüm bir foundation'dır. Özellikler tek tek ve test edilerek eklenecektir.
