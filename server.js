// Duyuru Takip - Sunucu
// Bu sunucu: kullanıcıların izlemek istediği duyuru sayfalarını kaydeder,
// periyodik olarak bu sayfaları kontrol eder ve yeni/eşleşen bir duyuru
// bulduğunda Web Push ile telefona bildirim gönderir.

const express = require("express");
const cors = require("cors");
const path = require("path");
const webpush = require("web-push");
const cheerio = require("cheerio");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- MongoDB bağlantısı (kalıcı depolama) ----
// MONGODB_URI ortam değişkeni MongoDB Atlas'tan alınan bağlantı adresidir.
// Bu sayede sunucu kaç kere yeniden başlarsa başlasın kayıtlar silinmez.
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("HATA: MONGODB_URI ortam değişkeni tanımlı değil.");
}

let watchesCollection;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  await client.connect();
  const db = client.db("duyurutakip");
  watchesCollection = db.collection("watches");
  console.log("MongoDB'ye bağlanıldı.");
}

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

// ---- Frontend'in public key alması için ----
app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ---- Yeni izleme kaydı oluşturma ----
app.post("/api/subscribe", async (req, res) => {
  const { url, keywords, subscription } = req.body;

  if (!url || !subscription) {
    return res.status(400).json({ error: "url ve subscription zorunludur" });
  }

  const newWatch = {
    url,
    keywords: Array.isArray(keywords)
      ? keywords.map((k) => k.trim().toLocaleLowerCase("tr")).filter(Boolean)
      : [],
    subscription,
    seenItems: [], // daha önce görülen duyuru metinleri
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await watchesCollection.insertOne(newWatch);
    res.json({ ok: true, id: result.insertedId });
  } catch (e) {
    console.error("Kayıt eklenemedi:", e.message);
    res.status(500).json({ error: "Kayıt eklenemedi" });
  }
});

// ---- Kayıtlı izlemeyi silme ----
app.delete("/api/subscribe/:id", async (req, res) => {
  try {
    await watchesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Silinemedi" });
  }
});

// ---- Bir sayfadaki olası duyuru metinlerini çıkarma ----
// Genel bir yaklaşım: <li>, <a>, <tr> gibi tekrar eden yapıların
// içindeki metinleri toplar. Siteye göre kalitesi değişebilir.
async function extractAnnouncementTexts(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
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
    console.error(`[${watch._id}] Sayfa okunamadı:`, e.message);
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
        console.error(`[${watch._id}] Bildirim gönderilemedi:`, e.message);
      }
    }
  }

  // Görülenler listesini güncelle (çok büyümesin diye son 500 ile sınırla)
  const updatedSeenItems = Array.from(
    new Set([...watch.seenItems, ...currentTexts])
  ).slice(-500);

  await watchesCollection.updateOne(
    { _id: watch._id },
    { $set: { seenItems: updatedSeenItems } }
  );
}

// ---- Tüm izlemeleri kontrol et ----
async function checkAllWatches() {
  const watches = await watchesCollection.find({}).toArray();
  for (const watch of watches) {
    try {
      await checkWatch(watch);
    } catch (e) {
      console.error(`[${watch._id}] Kontrol hatası:`, e.message);
    }
  }
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

// Önce veritabanına bağlan, sonra sunucuyu başlat.
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Sunucu ${PORT} portunda çalışıyor`);
    });
  })
  .catch((e) => {
    console.error("MongoDB bağlantısı kurulamadı:", e.message);
    process.exit(1);
  });
