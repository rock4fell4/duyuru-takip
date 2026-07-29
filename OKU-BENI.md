# Duyuru Takip — Kurulum Talimatları

Bu uygulama iki parçadan oluşur:
1. **Sunucu** (server.js) — duyuru sayfalarını periyodik kontrol eder, yeni/eşleşen duyuru bulunca bildirim gönderir.
2. **Web arayüzü** (public/ klasörü) — kullanıcının URL ve anahtar kelime girdiği, telefona "ana ekrana ekle" ile kurabileceği sayfa.

Aşağıdaki adımları sırayla takip et. Kod bilmesen de yapabilirsin, sadece adımları uygula.

---

## 1) VAPID anahtarlarını üret (bildirim için zorunlu)

Bilgisayarında Node.js kurulu olmalı (https://nodejs.org üzerinden indirebilirsin).

Terminal/komut satırında bu klasörün içine gir ve şu komutu çalıştır:

```
npx web-push generate-vapid-keys
```

Sana bir **Public Key** ve bir **Private Key** verecek. İkisini de bir yere not et, birazdan kullanacaksın.

## 2) Bağımlılıkları kur

Yine bu klasörün içindeyken:

```
npm install
```

## 3) Yerelde deneme (isteğe bağlı)

```
VAPID_PUBLIC_KEY=buraya_public_key VAPID_PRIVATE_KEY=buraya_private_key npm start
```

Tarayıcıda `http://localhost:3000` adresine gidip formu deneyebilirsin (bildirimler için gerçek bir cihazda/telefonda denemen daha sağlıklı olur).

## 4) İnternete yükleme (telefondan erişebilmek için)

Sunucunun 7/24 açık durması gerektiği için ücretsiz bir barındırma servisi kullanman gerekir. Önerilen: **Render.com**

1. https://render.com adresinde ücretsiz hesap aç.
2. Bu klasörü bir GitHub deposuna (repository) yükle.
3. Render'da "New +" → "Web Service" seç, GitHub deponu bağla.
4. Ortam değişkenleri (Environment Variables) kısmına ekle:
   - `VAPID_PUBLIC_KEY` = (1. adımda aldığın public key)
   - `VAPID_PRIVATE_KEY` = (1. adımda aldığın private key)
5. Build komutu: `npm install`, Start komutu: `npm start`
6. Deploy ettikten sonra Render sana bir adres verecek, örneğin: `https://duyuru-takip.onrender.com`

## 5) Sunucuyu uyanık tutma (önemli — ücretsiz planlar için)

Render'ın ücretsiz planı, belli bir süre istek gelmezse sunucuyu uyutur. Bu yüzden sunucunun periyodik kontrolü çalışabilmesi için dışarıdan düzenli "uyandırma" gerekir:

1. https://cron-job.org adresinde ücretsiz hesap aç.
2. Yeni bir "cron job" oluştur, adres olarak şunu gir:
   `https://SENIN-ADRESIN.onrender.com/api/check-now`
3. Her 5 dakikada bir çalışacak şekilde ayarla.

Bu sayede sunucu hem uyanık kalır hem de her tetiklemede tüm kayıtlı sayfaları kontrol eder.

## 6) Telefonda kullanma

1. Telefonun tarayıcısından (Android'de Chrome önerilir; iPhone'da Safari, iOS 16.4+ gerekir) `https://SENIN-ADRESIN.onrender.com` adresine git.
2. Duyurular sayfasının URL'sini yapıştır, istersen anahtar kelime gir (örn. "ders seçimi").
3. "Takibi başlat" butonuna bas, bildirim izni iste geldiğinde "İzin ver" de.
4. İstersen tarayıcı menüsünden "Ana ekrana ekle" seçeneğiyle bir uygulama simgesi gibi telefonuna ekleyebilirsin.

Artık o sayfada yeni bir duyuru yayınlandığında (ve anahtar kelimeyle eşleşiyorsa) telefonuna bildirim gelecek.

---

## Bilinmesi gerekenler / sınırlamalar

- Duyuru tespiti, sayfadaki tekrar eden liste/link yapılarını genel bir yöntemle tarayarak yapılır. Çok karmaşık veya JavaScript ile sonradan yüklenen (dinamik) sayfalarda tespit zayıf kalabilir.
- Bazı üniversite siteleri bot trafiğini engelleyebilir; böyle bir durumda sayfa okunamaz.
- iPhone'da web push bildirimleri için sayfanın mutlaka "ana ekrana eklenmiş" olması gerekir (Safari'de doğrudan sekmede çalışmaz).
- Bu, tek kullanıcı/küçük ölçek için basit bir çözümdür (veriler bir JSON dosyasında tutulur). Çok sayıda kişi kullanacaksa gerçek bir veritabanına geçmek gerekir.
