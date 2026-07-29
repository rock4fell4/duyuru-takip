// Duyuru Takip - Sunucu
// Bu sunucu: kullanıcıların izlemek istediği duyuru sayfalarını kaydeder,
// periyodik olarak bu sayfaları kontrol eder ve yeni/eşleşen bir duyuru
// bulduğunda Web Push ile telefona bildirim gönderir.

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const cheerio = require("cheerio");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "watches.json");

// ---- VAPID anahtarları (Web Push için gerekli) ----
// Bunları kendin üretmelisin: `npx web-push generate-vapid-keys`
// Ürettiğin anahtarları ortam değişkeni (environment variable) olarak
// VAPID_PUBLIC_KEY ve VAPID_PRIVATE_KEY şeklinde ayarla.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BURAYA_PUBLIC_KEY_GELECEK";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "BURAYA_PRIVATE_KEY_GELECEK";

webpush.setVapidDetails(
  "mailto:ornek@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ---- Basit dosya tabanlı depolama ----
function loadWatches() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch (e) {
    return [];
  }
}

function saveWatches(watches) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(watches, null, 2), "utf-8");
}

// ---- Frontend'in public key alması için ----
app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ---- Yeni izleme kaydı oluşturma ----
app.post("/api/subscribe", (req, res) => {
  const { url, keywords, subscription } = req.body;

  if (!url || !subscription) {
    return res.status(400).json({ error: "url ve subscription zorunludur" });
  }

  const watches = loadWatches();

  const newWatch = {
    id: crypto.randomUUID(),
    url,
    keywords: Array.isArray(keywords)
      ? keywords.map((k) => k.trim().toLocaleLowerCase("tr")).filter(Boolean)
      : [],
    subscription,
    seenItems: [], // daha önce görülen duyuru metinleri
    createdAt: new Date().toISOString(),
  };

  watches.push(newWatch);
  saveWatches(watches);

  res.json({ ok: true, id: newWatch.id });
});

// ---- Kayıtlı izlemeyi silme ----
app.delete("/api/subscribe/:id", (req, res) => {
  const watches = loadWatches().filter((w) => w.id !== req.params.id);
  saveWatches(watches);
  res.json({ ok: true });
});

// ---- Bir sayfadaki olası duyuru metinlerini çıkarma ----
// Genel bir yaklaşım: <li>, <a>, <tr> gibi tekrar eden yapıların
// içindeki metinleri toplar. Siteye göre kalitesi değişebilir.
async function extractAnnouncementTexts(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; DuyuruTakipBot/1.0; +https://example.com)",
    },
  });

  if (!response.ok) {
    throw new Error(`Sayfa alınamadı: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const texts = new Set();

  // Yaygın duyuru/haber listesi yapıları
  $("li, tr, article, .list-group-item, .announcement, .duyuru, a").each(
    (_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      // Çok kısa (menü öğesi vb.) veya aşırı uzun (tüm sayfa gövdesi) metinleri ele
      if (text.length >= 8 && text.length <= 300) {
        texts.add(text);
      }
    }
  );

  return Array.from(texts);
}

// ---- Tek bir izlemeyi kontrol et ----
async function checkWatch(watch) {
  let currentTexts;
  try {
    currentTexts = await extractAnnouncementTexts(watch.url);
  } catch (e) {
    console.error(`[${watch.id}] Sayfa okunamadı:`, e.message);
    return;
  }

  const seenSet = new Set(watch.seenItems);
  const newTexts = currentTexts.filter((t) => !seenSet.has(t));

  if (newTexts.length === 0) return;

  // İlk kontrolde (seenItems boşsa) bildirim atmadan sadece durumu kaydet,
  // yoksa sayfa ilk eklendiğinde tüm mevcut duyurular için bildirim patlar.
  const isFirstRun = watch.seenItems.length === 0;

  if (!isFirstRun) {
    const keywordMatches = watch.keywords.length
      ? newTexts.filter((t) =>
          watch.keywords.some((k) => t.toLocaleLowerCase("tr").includes(k))
        )
      : newTexts; // anahtar kelime yoksa her yeni duyuru bildirilir

    for (const match of keywordMatches) {
      try {
        await webpush.sendNotification(
          watch.subscription,
          JSON.stringify({
            title: "Yeni duyuru bulundu",
            body: match.slice(0, 150),
            url: watch.url,
          })
        );
      } catch (e) {
        console.error(`[${watch.id}] Bildirim gönderilemedi:`, e.message);
      }
    }
  }

  // Görülenler listesini güncelle (çok büyümesin diye son 500 ile sınırla)
  watch.seenItems = Array.from(new Set([...watch.seenItems, ...currentTexts])).slice(
    -500
  );
}

// ---- Tüm izlemeleri kontrol et ----
async function checkAllWatches() {
  const watches = loadWatches();
  for (const watch of watches) {
    await checkWatch(watch);
  }
  saveWatches(watches);
}

// Dışarıdan (örn. cron-job.org) tetiklenebilecek uç nokta.
// Render/Railway gibi ücretsiz planlarda sunucu uyuyabildiği için,
// ücretsiz bir dış servisle bu adresi düzenli aralıklarla "uyandırman" gerekir.
app.get("/api/check-now", async (req, res) => {
  await checkAllWatches();
  res.json({ ok: true, checkedAt: new Date().toISOString() });
});

// Sunucu kendi başına çalışırken (uyanıkken) de periyodik kontrol yapsın
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 dakika
setInterval(() => {
  checkAllWatches().catch((e) => console.error("Kontrol hatası:", e));
}, CHECK_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
