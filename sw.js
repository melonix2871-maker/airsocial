// sw.js - Service Worker for offline capabilities
const CACHE_NAME = 'p2p-social-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/lib/auth.js',
    '/lib/p2p.js',
    '/lib/database.js',
    '/lib/social.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});