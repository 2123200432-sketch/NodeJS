const CACHE_NAME = 'Todo-cahce-v1'
const urlsToCache = [
    "/",
    "/style.css",
    "/main.js",
    "/icons/icon-192x192.png",
    "/icons/icon-512x512.png",
];


self.addEventListener('install', (event) =>{
    event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>{
        return cache.addAll(urlsToCache);
    })
);
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cachesNames) =>{
            return Promise.all(
                cachesNames.map((cachesName) => {
                    if (cachesName !== CACHE_NAME){
                        return caches.delete(cachesName);
                    }
                })
            );
        })
    );
});