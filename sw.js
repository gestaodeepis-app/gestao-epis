const CACHE="gestao-epis-v2-0-7";
const STATIC_ASSETS=[
  "./","./index.html","./manifest.json","./firebase-config.js","./logo-symbol.png",
  "./styles.css?v=2.0.7","./app.js?v=2.0.7","./version.json",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png",
  "./favicon-32.png","./favicon-16.png","./share-card.png"
];

self.addEventListener("message",event=>{
  if(event.data?.type==="SKIP_WAITING")self.skipWaiting();
});

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.all(STATIC_ASSETS.map(async asset=>{
      try{await cache.add(asset)}catch(_){
        // Não impede a instalação se um asset opcional falhar.
      }
    }));
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("gestao-epis-")&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  const isFresh=url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/sw.js") ||
    event.request.mode==="navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css");

  if(isFresh){
    event.respondWith(
      fetch(event.request,{cache:"no-store"}).then(response=>{
        if(response&&response.ok){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        }
        return response;
      }).catch(()=>caches.match(event.request).then(r=>r||caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
      if(response&&response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      }
      return response;
    }))
  );
});
