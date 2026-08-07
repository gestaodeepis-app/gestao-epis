const CACHE="gestao-epis-v2-1-0";
const STATIC_ASSETS=[
  "./","./index.html","./manifest.json","./firebase-config.js","./logo-symbol.png",
  "./styles.css?v=2.1.0","./app.js?v=2.1.0","./version.json",
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
      try{await cache.add(asset)}catch(_){}
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

function offlineResponse(){
  return new Response("Sem conexão com a internet.",{
    status:503,
    statusText:"Offline",
    headers:{"Content-Type":"text/plain; charset=utf-8"}
  });
}

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  const isNavigation=event.request.mode==="navigate";
  const isFresh=isNavigation ||
    url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/sw.js") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css");

  if(isFresh){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:"no-store"});
        if(response?.ok){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
        }
        return response;
      }catch(_){
        if(isNavigation){
          return (await caches.match("./index.html")) || (await caches.match("./")) || offlineResponse();
        }
        return (await caches.match(event.request)) || offlineResponse();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    if(cached)return cached;
    try{
      const response=await fetch(event.request);
      if(response?.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
      }
      return response;
    }catch(_){
      return offlineResponse();
    }
  })());
});
