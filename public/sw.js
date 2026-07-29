// Bu service worker, tarayıcı/uygulama kapalıyken bile
// push bildirimini yakalayıp ekranda göstermekten sorumludur.

self.addEventListener("push", (event) => {
  let data = { title: "Yeni duyuru", body: "Bir güncelleme var.", url: "/" };
  try {
    data = event.data.json();
  } catch (e) {
    // JSON değilse varsayılan mesajı kullan
  }

  const options = {
    body: data.body,
    icon: "icon.png",
    badge: "icon.png",
    data: { url: data.url },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url;
  if (targetUrl) {
    event.waitUntil(clients.openWindow(targetUrl));
  }
});
