// Yalnız panonun telefonda "uygulama gibi" (ana ekrandan, tarayıcı çubuğu olmadan) açılabilmesi için.
// Önbellek tutulmaz: her istek olduğu gibi ağa gider, pano her açılışta güncel veri ve güncel sürümle gelir.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
