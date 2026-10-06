const SHARE_CACHE='b50-pocket-share-v1';
const SHARE_KEY='/b50-pocket/shared-result-image';

self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method==='POST'&&url.pathname==='/b50-pocket/share'){
    event.respondWith((async()=>{
      try{
        const form=await event.request.formData();
        const file=form.get('image');
        if(file instanceof File&&file.size){
          const cache=await caches.open(SHARE_CACHE);
          await cache.put(SHARE_KEY,new Response(file,{headers:{'Content-Type':file.type||'image/jpeg'}}));
          return Response.redirect('/b50-pocket/?shared=1',303);
        }
      }catch{}
      return Response.redirect('/b50-pocket/?share_error=1',303);
    })());
  }
});
