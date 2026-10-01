const app = document.getElementById('app');
const hudWidget = document.getElementById('hud-widget');
const hudCover = document.getElementById('hudCover');
const hudTitle = document.getElementById('hudTitle');
const hudArtist = document.getElementById('hudArtist');
const hudProgressFill = document.getElementById('hudProgressFill');
const hudEq = document.getElementById('hudEq');

const coverEl = document.getElementById('cover');
const ambientBg = document.getElementById('ambientBg');
const titleEl = document.getElementById('title');
const urlText = document.getElementById('urlText');
const queueList = document.getElementById('queueList');
const urlInput = document.getElementById('urlInput');
const searchResultsEl = document.getElementById('searchResults');
const addSectionEl = document.querySelector('.add-section');
const message = document.getElementById('message');
const addBtnLabel = document.querySelector('#addBtn span');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const progress = document.getElementById('progress');
const volume = document.getElementById('volume');
const currentEl = document.getElementById('current');
const durationEl = document.getElementById('duration');
const dockClock = document.getElementById('dockClock');
const vehiclePlate = document.getElementById('vehiclePlate');

const viewMusic = document.getElementById('viewMusic');
const viewRadio = document.getElementById('viewRadio');
const viewPhone = document.getElementById('viewPhone');
const radioGrid = document.getElementById('radioGrid');

const tabMusicBtn = document.getElementById('tabMusicBtn');
const tabRadioBtn = document.getElementById('tabRadioBtn');
const tabPhoneBtn = document.getElementById('tabPhoneBtn');
const tabPartyBtn = document.getElementById('tabPartyBtn');
const tabThemeBtn = document.getElementById('tabThemeBtn');
const dockHomeBtn = document.getElementById('dockHomeBtn');
const viewParty = document.getElementById('viewParty');
const viewTheme = document.getElementById('viewTheme');

const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const muteBtn = document.getElementById('muteBtn');

let queue = [];
let currentIndex = -1;
let player = null;
let playerReady = false;
let progressTimer = null;
let eqInterval = null;
let isInVehicleState = false;
let isGameRadioActive = false;
let isDriverState = true;

let currentSyncedId = null;
let currentSyncedNetId = null;
let partyState = null;
let partyMember = false;
let partyTrackId = null;

function setDriverMode(isDriver) {
    isDriverState = isDriver;

    const interactiveBtns = [
        document.getElementById('addBtn'),
        document.getElementById('playBtn'),
        document.getElementById('nextBtn'),
        document.getElementById('prevBtn'),
        document.getElementById('shuffleBtn'),
        document.getElementById('repeatBtn'),
        document.getElementById('clearBtn'),
        progress
    ];

    if (!isDriver) {
        urlInput.disabled = true;
        urlInput.placeholder = '🔒 Controlado por el Conductor';
        interactiveBtns.forEach(btn => {
            if (btn) {
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.4';
            }
        });
        if (message) {
            message.style.color = '#ff9f0a';
            message.textContent = '🔒 Modo Pasajero: Solo el conductor puede cambiar la música.';
        }
    } else {
        urlInput.disabled = false;
        urlInput.placeholder = 'Nombre, artista o enlace (canción / playlist)...';
        interactiveBtns.forEach(btn => {
            if (btn) {
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
            }
        });
        if (message) {
            message.textContent = '';
        }
    }

    if (partyMember) {
        ['addBtn', 'nextBtn', 'prevBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        });
        if (urlInput) {
            urlInput.disabled = false;
            urlInput.placeholder = 'Busca o pega un enlace para la party...';
        }
        if (message && partyState) {
            message.style.color = '#bf5af2';
            message.textContent = `Party de ${partyState.hostName || 'tu grupo'}. Puedes añadir y saltar canciones.`;
        }
    }
}

let isMuted = false;
let lastVolume = 70;
let isShuffle = false;
let repeatMode = 0; // 0: Off, 1: Repeat All, 2: Repeat One

const h5Audio = document.getElementById('h5Player');
let lastStreamVideoId = null;

async function fetchAudioStream(videoId) {
    const endpoints = [
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://inv.tux.pizza/api/v1/videos/${videoId}`,
        `https://invidious.drgns.space/api/v1/videos/${videoId}`
    ];
    for (const ep of endpoints) {
        try {
            const res = await fetch(ep);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.audioStreams) && data.audioStreams.length > 0) {
                    return data.audioStreams[0].url;
                }
                if (Array.isArray(data.adaptiveFormats) && data.adaptiveFormats.length > 0) {
                    const audio = data.adaptiveFormats.find(f => f && f.type && f.type.includes('audio'));
                    if (audio && audio.url) return audio.url;
                }
            }
        } catch (_) {}
    }
    return null;
}

async function playDualAudio(videoId, startPos = 0, vol = 70) {
    const numVol = isMuted ? 0 : Number(vol);
    const normalizedVol = Math.max(0, Math.min(1, numVol / 100));

    if (playerReady && player && typeof player.loadVideoById === 'function') {
        try {
            player.loadVideoById(videoId, startPos);
            player.setVolume(numVol);
            player.playVideo();
        } catch (_) {}
    }

    if (h5Audio && lastStreamVideoId !== videoId) {
        lastStreamVideoId = videoId;
        const streamUrl = await fetchAudioStream(videoId);
        if (streamUrl) {
            h5Audio.src = streamUrl;
            h5Audio.currentTime = startPos;
            h5Audio.volume = normalizedVol;
            h5Audio.play().catch(() => {});
        }
    } else if (h5Audio && h5Audio.src) {
        h5Audio.currentTime = startPos;
        h5Audio.volume = normalizedVol;
        h5Audio.play().catch(() => {});
    }
}

function updateDualVolume(vol) {
    const numVol = isMuted ? 0 : Number(vol);
    const normalizedVol = Math.max(0, Math.min(1, numVol / 100));

    if (playerReady && player && typeof player.setVolume === 'function') {
        try { player.setVolume(numVol); } catch (_) {}
    }
    if (h5Audio) {
        h5Audio.volume = normalizedVol;
    }
}

function syncDualTime(targetPos) {
    if (playerReady && player && typeof player.getCurrentTime === 'function') {
        try {
            const cur = player.getCurrentTime();
            if (Math.abs(cur - targetPos) > 3.5) player.seekTo(targetPos, true);
        } catch (_) {}
    }
    if (h5Audio && !h5Audio.paused && h5Audio.duration > 0) {
        if (Math.abs(h5Audio.currentTime - targetPos) > 3.5) {
            h5Audio.currentTime = targetPos;
        }
    }
}

function stopDualAudio() {
    lastStreamVideoId = null;
    if (playerReady && player && typeof player.pauseVideo === 'function') {
        try { player.pauseVideo(); } catch (_) {}
    }
    if (h5Audio) {
        h5Audio.pause();
        h5Audio.src = '';
    }
}

const gtaRadioStations = [
    { raw: "RADIO_12_REGGAE", name: "Blue Ark" },
    { raw: "RADIO_01_CLASS_ROCK", name: "Los Santos Rock Radio" },
    { raw: "RADIO_02_POP", name: "Non-Stop-Pop FM" },
    { raw: "RADIO_03_HIPHOP", name: "Radio Los Santos" },
    { raw: "RADIO_09_HIPHOP_OLD", name: "West Coast Classics" },
    { raw: "RADIO_16_SILVERLAKE", name: "Radio Mirror Park" },
    { raw: "RADIO_14_DANCE_02", name: "FlyLo FM" },
    { raw: "RADIO_21_SLC", name: "Blonded Los Santos 97.8 FM" },
    { raw: "RADIO_36_MOTOMAMI", name: "MOTOMAMI Los Santos" },
    { raw: "RADIO_04_PUNK", name: "Channel X" },
    { raw: "RADIO_06_COUNTRY", name: "Rebel Radio" },
    { raw: "RADIO_07_DANCE_01", name: "Soulwax FM" },
    { raw: "RADIO_08_MEXICAN", name: "East Los FM" },
    { raw: "RADIO_13_JAZZ", name: "Worldwide FM" },
    { raw: "RADIO_15_MOTOWN", name: "The Lowdown 91.1" },
    { raw: "RADIO_17_FUNK", name: "Space 103.2" },
    { raw: "RADIO_18_90S_ROCK", name: "Vinewood Boulevard Radio" },
    { raw: "RADIO_20_THELAB", name: "The Lab" }
];

function nui(name, data = {}) {
    return fetch(`https://${GetParentResourceName()}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).catch(() => {});
}

function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    if (dockClock) dockClock.textContent = `${hours}:${minutes}`;
}
setInterval(updateClock, 1000);
updateClock();

function switchTab(activeBtn, activeView) {
    [tabMusicBtn, tabRadioBtn, tabPhoneBtn, tabPartyBtn, tabThemeBtn].forEach(btn => btn && btn.classList.remove('active'));
    [viewMusic, viewRadio, viewPhone, viewParty, viewTheme].forEach(v => v && v.classList.add('hidden'));

    if (activeBtn) activeBtn.classList.add('active');
    if (activeView) activeView.classList.remove('hidden');
}

dockHomeBtn.onclick = () => switchTab(tabMusicBtn, viewMusic);
tabMusicBtn.onclick = () => switchTab(tabMusicBtn, viewMusic);
tabRadioBtn.onclick = () => {
    switchTab(tabRadioBtn, viewRadio);
    renderRadioGrid();
};
tabPhoneBtn.onclick = () => switchTab(tabPhoneBtn, viewPhone);
tabPartyBtn.onclick = () => {
    switchTab(tabPartyBtn, viewParty);
    if (partyState && partyState.isHost) nui('partyNearby');
};
tabThemeBtn.onclick = () => switchTab(tabThemeBtn, viewTheme);

const carplayThemes = [
    { id: 'ios', name: 'CarPlay', tag: 'Now Playing', mark: '‹', phone: 'CarPlay conectado', icon: '📱', desc: 'Pantalla clara iFruit, portada y cola.', dock: '#ffffff', face: '#f2f2f7', accent: '#111111' },
    { id: 'ios-dark', name: 'CarPlay Oscuro', tag: 'Now Playing', mark: '‹', phone: 'CarPlay conectado', icon: '📱', desc: 'Mismo CarPlay, modo noche.', dock: '#000000', face: '#1c1c1e', accent: '#f2f2f7' },
    { id: 'android', name: 'Android Auto', tag: 'iFruit', mark: '●', phone: 'Android Auto conectado', icon: '▶', desc: 'Negro, portada grande y cola al lado.', dock: '#000000', face: '#2b2b2b', accent: '#ffffff' },
    { id: 'android-dark', name: 'Android Auto Oscuro', tag: 'iFruit', mark: '●', phone: 'Android Auto conectado', icon: '▶', desc: 'Android Auto en negro puro.', dock: '#000000', face: '#000000', accent: '#ffffff' },
    { id: 'aurora', name: 'Aurora', tag: 'AURORA', mark: '✦', phone: 'Aurora Link conectado', icon: '✦', desc: 'Vidrio fluido, cian y violeta.', dock: '#111827', face: '#312e81', accent: '#67e8f9' },
    { id: 'carbon', name: 'Carbon', tag: 'CARBON', mark: '◆', phone: 'Carbon Link conectado', icon: '◆', desc: 'OLED fino, plata y contraste.', dock: '#050505', face: '#171717', accent: '#e5e7eb' },
    { id: 'sunset', name: 'Sunset', tag: 'SUNSET', mark: '☀', phone: 'Sunset Link conectado', icon: '☀', desc: 'Coral cálido, suave y moderno.', dock: '#43141b', face: '#9a3412', accent: '#fb7185' },
    { id: 'spotify', name: 'Spotify', tag: 'Spotify', mark: '♪', phone: 'Spotify conectado', icon: '♪', desc: 'Negro, verde y Now Playing 1:1.', dock: '#000000', face: '#121212', accent: '#1ed760' }
];

function applyCarplayTheme(themeId, animate) {
    const theme = carplayThemes.find(item => item.id === themeId) || carplayThemes[0];
    if (animate) {
        document.documentElement.classList.add('theme-switching');
        setTimeout(() => document.documentElement.classList.remove('theme-switching'), 520);
    }
    document.documentElement.dataset.theme = theme.id;
    try { localStorage.setItem('carplay-theme', theme.id); } catch (_) {}

    const brandName = document.getElementById('brandName');
    const brandMark = document.getElementById('brandMark');
    const hudKey = document.getElementById('hudKeyLabel');
    const phoneTitle = document.getElementById('phoneTitle');
    const phoneIcon = document.getElementById('phoneIcon');
    if (brandName) brandName.textContent = theme.tag;
    if (brandMark) brandMark.textContent = theme.mark;
    if (hudKey) hudKey.textContent = theme.tag;
    if (phoneTitle) phoneTitle.textContent = theme.phone;
    if (phoneIcon) phoneIcon.textContent = theme.icon;

    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === theme.id);
    });

    if (titleEl && titleEl.textContent === 'Sin reproducción') {
        const idle = theme.id === 'spotify' ? 'Reproduciendo en Spotify' : 'Reproduciendo en iFruit';
        if (urlText) urlText.textContent = idle;
        if (hudArtist) hudArtist.textContent = idle;
    }
}

function renderThemeGrid() {
    const grid = document.getElementById('themeGrid');
    if (!grid || grid.childElementCount) return;
    carplayThemes.forEach(theme => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'theme-card';
        card.dataset.theme = theme.id;
        card.innerHTML = `
            <div class="theme-preview">
                <i style="background:${theme.dock}"></i>
                <i style="background:linear-gradient(135deg, ${theme.face}, ${theme.accent})"></i>
            </div>
            <strong>${theme.name}</strong>
            <span>${theme.desc}</span>
        `;
        card.onclick = () => applyCarplayTheme(theme.id, true);
        grid.appendChild(card);
    });
    const saved = document.documentElement.dataset.theme || 'ios';
    applyCarplayTheme(saved, false);
}

renderThemeGrid();

function syncCoverOverlay() {
    const overlayTitle = document.getElementById('coverOverlayTitle');
    const overlayArtist = document.getElementById('coverOverlayArtist');
    if (overlayTitle) overlayTitle.textContent = titleEl ? titleEl.textContent : '';
    if (overlayArtist) overlayArtist.textContent = urlText ? urlText.textContent : '';
}

if (titleEl) {
    const overlayObs = new MutationObserver(syncCoverOverlay);
    overlayObs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    if (urlText) overlayObs.observe(urlText, { childList: true, characterData: true, subtree: true });
}
syncCoverOverlay();

function renderRadioGrid() {
    radioGrid.innerHTML = '';
    gtaRadioStations.forEach(st => {
        const item = document.createElement('div');
        item.className = 'radio-card-item';

        const icon = document.createElement('div');
        icon.className = 'radio-icon-box';
        icon.textContent = '📻';

        const name = document.createElement('div');
        name.className = 'radio-name-text';
        name.textContent = st.name;

        item.append(icon, name);
        item.onclick = () => {
            if (partyMember || !isDriverState) {
                if (message) {
                    message.style.color = partyMember ? '#bf5af2' : '#ff9f0a';
                    message.textContent = partyMember
                        ? 'Estás en una party. Sal del grupo para cambiar la radio.'
                        : '🔒 Solo el conductor puede cambiar de emisora.';
                }
                return;
            }
            player?.stopVideo();
            currentIndex = -1;
            renderQueue();

            nui('setRadioStation', { stationName: st.raw });
            hudTitle.textContent = st.name;
            hudArtist.textContent = 'Radio de GTA V';
            titleEl.textContent = st.name;
            urlText.textContent = 'Radio de GTA V';
            clearNowPlayingArt('📻');
            updateEqAnimation(true);
            switchTab(tabMusicBtn, viewMusic);
        };
        radioGrid.appendChild(item);
    });
}

function extractYouTubeId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtu.be')) {
            return u.pathname.replace('/', '').split('?')[0];
        }
        if (u.hostname.includes('youtube.com')) {
            if (u.pathname === '/watch') return u.searchParams.get('v');
            if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
            if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
        }
    } catch (_) {}
    return null;
}

function extractYouTubePlaylistId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
            const listParam = u.searchParams.get('list');
            if (listParam) return listParam;
        }
    } catch (_) {}
    return null;
}

const thumbBestCache = {};

function getThumbnailUrl(id, kind = 'list') {
    if (!id) return '';
    if (thumbBestCache[id]) return thumbBestCache[id];
    if (kind === 'hero') return `https://i.ytimg.com/vi/${id}/hq720.jpg`;
    return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

function resolveBestThumb(id, onReady) {
    if (!id) return;
    if (thumbBestCache[id]) {
        onReady(thumbBestCache[id]);
        return;
    }
    const candidates = [
        `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/hq720.jpg`,
        `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
    ];
    let i = 0;
    const probe = () => {
        if (i >= candidates.length) return;
        const url = candidates[i];
        const img = new Image();
        img.onload = () => {
            if (img.naturalWidth >= 320 && img.naturalHeight >= 180) {
                thumbBestCache[id] = url;
                onReady(url);
                return;
            }
            i += 1;
            probe();
        };
        img.onerror = () => {
            i += 1;
            probe();
        };
        img.src = url;
    };
    probe();
}

function setMediaArt(el, id) {
    if (!el) return;
    let photo = el.querySelector('.cover-photo');
    if (!id) {
        if (photo) photo.remove();
        el.style.backgroundImage = 'none';
        return;
    }
    if (!photo) {
        photo = document.createElement('img');
        photo.className = 'cover-photo';
        photo.alt = '';
        photo.draggable = false;
        el.insertBefore(photo, el.firstChild);
    }
    el.querySelectorAll('.cover-fallback, .hud-note').forEach((node) => node.remove());
    const preview = getThumbnailUrl(id, 'list');
    photo.src = preview;
    el.style.backgroundImage = 'none';
    resolveBestThumb(id, (url) => {
        if (photo.isConnected) photo.src = url;
    });
}

function setAmbientArt(id) {
    if (!ambientBg) return;
    if (!id) {
        ambientBg.style.backgroundImage = 'none';
        return;
    }
    ambientBg.style.backgroundImage = `url('${getThumbnailUrl(id, 'hero')}')`;
    resolveBestThumb(id, (url) => {
        ambientBg.style.backgroundImage = `url('${url}')`;
    });
}

function setNowPlayingArt(id) {
    setMediaArt(coverEl, id);
    setMediaArt(hudCover, id);
    setAmbientArt(id);
}

function clearNowPlayingArt(fallback) {
    const mark = fallback || '♪';
    if (coverEl) {
        coverEl.style.backgroundImage = 'none';
        coverEl.innerHTML = `<span class="cover-fallback">${mark}</span>`;
    }
    if (hudCover) {
        hudCover.style.backgroundImage = 'none';
        hudCover.innerHTML = `<span class="hud-note">${mark}</span>`;
    }
    if (ambientBg) ambientBg.style.backgroundImage = 'none';
}

async function fetchMetadata(url, videoId) {
    try {
        const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        if (response.ok) {
            const data = await response.json();
            if (data && data.title) {
                return {
                    title: data.title,
                    author: data.author_name || 'YouTube'
                };
            }
        }
    } catch (_) {}

    return {
        title: 'Audio de YouTube',
        author: 'Reproduciendo desde YouTube'
    };
}

async function fetchPlaylistItems(playlistId) {
    const maxTracks = 10;
    const endpoints = [
        `https://inv.tux.pizza/api/v1/playlists/${playlistId}`,
        `https://invidious.drgns.space/api/v1/playlists/${playlistId}`,
        `https://pipedapi.kavin.rocks/playlists/${playlistId}`
    ];

    for (const ep of endpoints) {
        try {
            const res = await fetch(ep);
            if (res.ok) {
                const data = await res.json();
                
                // Invidious format (FIFO: first 10 items in order)
                if (data && Array.isArray(data.videos) && data.videos.length > 0) {
                    return data.videos.slice(0, maxTracks).map(v => ({
                        id: v.videoId,
                        url: `https://www.youtube.com/watch?v=${v.videoId}`,
                        title: v.title || 'Canción de Playlist',
                        author: v.author || 'YouTube'
                    }));
                }

                // Piped format (FIFO: first 10 items in order)
                if (data && Array.isArray(data.relatedStreams) && data.relatedStreams.length > 0) {
                    return data.relatedStreams
                        .slice(0, maxTracks)
                        .map(v => {
                            const vid = extractYouTubeId(`https://www.youtube.com${v.url}`);
                            return {
                                id: vid,
                                url: `https://www.youtube.com/watch?v=${vid}`,
                                title: v.title || 'Canción de Playlist',
                                author: v.uploaderName || 'YouTube'
                            };
                        })
                        .filter(item => item.id);
                }
            }
        } catch (_) {}
    }

    // Fallback: Use YouTube iframe API if player is ready (Strict FIFO indexing)
    if (playerReady && player && typeof player.loadPlaylist === 'function') {
        try {
            player.loadPlaylist({ list: playlistId, listType: 'playlist' });
            await new Promise(r => setTimeout(r, 800));
            const list = player.getPlaylist();
            if (Array.isArray(list) && list.length > 0) {
                const targetList = list.slice(0, maxTracks);
                const items = await Promise.all(targetList.map(async (vid) => {
                    const meta = await fetchMetadata('', vid);
                    return {
                        id: vid,
                        url: `https://www.youtube.com/watch?v=${vid}`,
                        title: meta.title,
                        author: meta.author
                    };
                }));
                return items.filter(item => item.id);
            }
        } catch (_) {}
    }

    return [];
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    seconds = Math.max(0, Math.floor(seconds));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateEqAnimation(isPlaying) {
    const spans = hudEq.querySelectorAll('span');
    if (isPlaying) {
        hudEq.classList.remove('paused');
        if (!eqInterval) {
            eqInterval = setInterval(() => {
                spans.forEach(span => {
                    span.style.height = `${Math.floor(Math.random() * 9) + 3}px`;
                });
            }, 180);
        }
    } else {
        hudEq.classList.add('paused');
        if (eqInterval) {
            clearInterval(eqInterval);
            eqInterval = null;
        }
        spans.forEach(span => {
            span.style.height = '3px';
        });
    }
}

function broadcastPartyQueue() {
    if (!partyState || !partyState.isHost) return;
    nui('partyQueueSync', {
        queue: queue.map(item => ({
            id: item.id,
            url: item.url || '',
            title: item.title || 'Audio de YouTube',
            author: item.author || ''
        })),
        index: currentIndex
    });
}

function broadcastSync(overrideIsPlaying = null) {
    if (partyMember) return;
    if (currentIndex < 0 || !queue[currentIndex]) {
        nui('syncTrackState', { isPlaying: false });
        return;
    }

    const item = queue[currentIndex];
    const isPlaying = (overrideIsPlaying !== null) 
        ? overrideIsPlaying 
        : (playerReady && player ? player.getPlayerState() === YT.PlayerState.PLAYING : false);

    const currentTime = (playerReady && player && typeof player.getCurrentTime === 'function') ? player.getCurrentTime() : (h5Audio ? h5Audio.currentTime : 0);
    const duration = (playerReady && player && typeof player.getDuration === 'function') ? player.getDuration() : (h5Audio ? h5Audio.duration : 0);

    nui('syncTrackState', {
        id: item.id,
        title: item.title,
        author: item.author,
        url: item.url,
        isPlaying: isPlaying,
        baseVolume: Number(volume.value),
        position: currentTime,
        duration: duration
    });
}

function renderQueue() {
    queueList.innerHTML = '';

    if (!queue.length) {
        queueList.innerHTML = '<div style="opacity:.5;padding:12px 0;font-size:11px;text-align:center;">La cola está vacía.</div>';
        return;
    }

    queue.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = `queue-item ${index === currentIndex ? 'active' : ''}`;

        const indexEl = document.createElement('div');
        indexEl.className = 'queue-index';
        indexEl.textContent = index + 1;

        const thumb = document.createElement('div');
        thumb.className = 'queue-thumb';
        if (item.id) {
            setMediaArt(thumb, item.id);
        } else {
            thumb.textContent = '♪';
        }

        const info = document.createElement('div');
        info.className = 'queue-info';

        const tTitle = document.createElement('div');
        tTitle.className = 'queue-title-text';
        tTitle.textContent = item.title || 'Audio de YouTube';

        const tSub = document.createElement('div');
        tSub.className = 'queue-sub-text';
        tSub.textContent = item.author || 'Reproduciendo desde YouTube';

        info.append(tTitle, tSub);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            if (!partyMember) removeFromQueue(index);
        };

        row.append(indexEl, thumb, info);
        if (!partyMember) row.append(removeBtn);
        row.onclick = () => {
            if (partyMember) {
                nui('partyPlayIndex', { index });
                return;
            }
            playIndex(index);
        };

        queueList.appendChild(row);
    });
}

function sendTracksToParty(items) {
    const clean = items.filter(item => item && item.id).slice(0, 10);
    if (!clean.length) return;
    nui('partyQueueAdd', { items: clean });
    if (message) {
        message.style.color = '#30d158';
        message.textContent = clean.length > 1
            ? `Enviaste ${clean.length} canciones a la party.`
            : 'Canción enviada a la party.';
    }
}

let lastSearchResults = [];
let searchTimer = null;
let searchToken = 0;

function looksLikeYouTubeInput(value) {
    const v = (value || '').trim();
    if (!v) return false;
    const normalized = /^https?:\/\//i.test(v)
        ? v
        : (/^(www\.)?(youtube\.com|youtu\.be)\//i.test(v) ? `https://${v}` : '');
    if (!normalized) return false;
    try {
        const host = new URL(normalized).hostname.replace(/^www\./, '');
        return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
    } catch (_) {
        return false;
    }
}

function normalizeYouTubeInput(value) {
    const v = (value || '').trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (/^(www\.)?(youtube\.com|youtu\.be)\//i.test(v)) return `https://${v}`;
    return v;
}

function updateAddBtnLabel() {
    if (!addBtnLabel) return;
    addBtnLabel.textContent = looksLikeYouTubeInput(urlInput.value) ? '+ Añadir' : 'Buscar';
}

function cleanArtistName(name) {
    return String(name || '')
        .replace(/\s*[-–]?\s*(Topic|VEVO|Official|Oficial|Records|Music)\s*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function cleanSongTitle(raw) {
    let t = String(raw || '');
    t = t.replace(/【[^】]*】/g, '');
    t = t.replace(/\s*[\(\[\{][^)\]\}]{0,90}[\)\]\}]/gi, (chunk) => {
        return /\b(official|oficial|video|audio|lyrics?|letra|visualizer|hd|4k|8k|vevo|music\s*video|videoclip|mv|color\s*coded|explicit|hq|full\s*album|tema|audio\s*oficial|video\s*oficial|lyric\s*video|performance|live|en\s*vivo|remix\s*video)\b/i.test(chunk)
            ? ''
            : chunk;
    });
    t = t.replace(/\s*[-–—|:]\s*(official|oficial|video oficial|audio oficial|lyrics?|letra).*$/i, '');
    t = t.replace(/\s{2,}/g, ' ').replace(/^[-–—:|]\s*|\s*[-–—:|]$/g, '').trim();
    return t || String(raw || '').trim();
}

function parseTrackDisplay(title, author) {
    const cleaned = cleanSongTitle(title);
    const artistFromChannel = cleanArtistName(author);
    const parts = cleaned.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
        const left = parts[0].trim();
        const right = parts.slice(1).join(' - ').trim();
        if (left && right && left.length <= 48) {
            return { title: right, artist: left };
        }
    }
    return { title: cleaned, artist: artistFromChannel || 'Artista' };
}

function formatSearchDuration(value) {
    if (typeof value === 'string' && /^\d+:\d{2}/.test(value)) return value;
    const sec = Number(value);
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

function hideSearchResults() {
    lastSearchResults = [];
    if (addSectionEl) addSectionEl.classList.remove('is-searching');
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = '';
    searchResultsEl.classList.add('hidden');
}

function enqueueLocalTracks(items, successText) {
    const clean = items.filter(item => item && item.id);
    if (!clean.length) return;
    const wasEmpty = queue.length === 0 || currentIndex === -1;
    const startIndex = queue.length;
    clean.forEach(item => queue.push(item));
    renderQueue();
    broadcastPartyQueue();
    if (message) {
        message.style.color = '#30d158';
        message.textContent = successText;
    }
    if (wasEmpty) playIndex(startIndex);
}

function normalizeSearchItems(list) {
    return (list || []).map((v) => {
        if (!v || !v.id) return null;
        const parsed = parseTrackDisplay(v.title || 'Canción', v.author || '');
        return {
            id: v.id,
            url: v.url || `https://www.youtube.com/watch?v=${v.id}`,
            title: parsed.title,
            author: parsed.artist,
            duration: v.duration || ''
        };
    }).filter(Boolean).slice(0, 12);
}

let searchWaiters = {};
let searchReqId = 0;

function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function raceBrowserSearch(query) {
    const q = encodeURIComponent(query);
    const endpoints = [
        `https://inv.nadeko.net/api/v1/search?type=video&q=${q}`,
        `https://yewtu.be/api/v1/search?type=video&q=${q}`,
        `https://pipedapi.kavin.rocks/search?filter=videos&q=${q}`
    ];
    const jobs = endpoints.map(async (ep) => {
        const res = await fetchWithTimeout(ep, 1800);
        if (!res.ok) throw new Error('bad');
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.items || []);
        const mapped = list.map((v) => {
            const rawUrl = v.url || '';
            const id = v.videoId
                || extractYouTubeId(rawUrl.startsWith('http') ? rawUrl : `https://www.youtube.com${rawUrl}`)
                || extractYouTubeId(rawUrl);
            if (!id || (v.type && v.type !== 'video')) return null;
            const parsed = parseTrackDisplay(v.title || 'Canción', v.author || v.uploaderName || '');
            return {
                id,
                url: `https://www.youtube.com/watch?v=${id}`,
                title: parsed.title,
                author: parsed.artist,
                duration: formatSearchDuration(v.lengthSeconds ?? v.duration)
            };
        }).filter(Boolean);
        if (!mapped.length) throw new Error('empty');
        return mapped.slice(0, 12);
    });
    return new Promise((resolve) => {
        let left = jobs.length;
        let won = false;
        jobs.forEach((job) => {
            job.then((items) => {
                if (won || !items || !items.length) {
                    left -= 1;
                    if (!won && left <= 0) resolve([]);
                    return;
                }
                won = true;
                resolve(items);
            }).catch(() => {
                left -= 1;
                if (!won && left <= 0) resolve([]);
            });
        });
    });
}

function fetchSearchVideos(query) {
    return new Promise((resolve) => {
        const reqId = ++searchReqId;
        let settled = false;
        const finish = (items) => {
            if (settled) return;
            const clean = normalizeSearchItems(items);
            if (!clean.length && searchWaiters[reqId]) return;
            settled = true;
            delete searchWaiters[reqId];
            resolve(clean);
        };
        searchWaiters[reqId] = (items) => {
            const clean = normalizeSearchItems(items);
            if (clean.length) finish(clean);
        };
        nui('searchSongs', { query, reqId });
        raceBrowserSearch(query).then((items) => {
            if (items && items.length) finish(items);
        });
        setTimeout(() => {
            if (settled) return;
            settled = true;
            delete searchWaiters[reqId];
            resolve([]);
        }, 4500);
    });
}

function renderSearchResults(items) {
    lastSearchResults = items;
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = '';
    if (!items.length) {
        hideSearchResults();
        return;
    }

    if (addSectionEl) addSectionEl.classList.add('is-searching');
    searchResultsEl.classList.remove('hidden');

    const head = document.createElement('div');
    head.className = 'search-list-head';
    const label = document.createElement('span');
    label.textContent = 'Canciones';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'search-list-close';
    closeBtn.textContent = 'Cerrar';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        hideSearchResults();
        if (message) message.textContent = '';
    };
    head.append(label, closeBtn);
    searchResultsEl.appendChild(head);

    items.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ytm-row';

        const cover = document.createElement('div');
        cover.className = 'ytm-cover';
        setMediaArt(cover, item.id);

        const meta = document.createElement('div');
        meta.className = 'ytm-meta';

        const tTitle = document.createElement('div');
        tTitle.className = 'ytm-title';
        tTitle.textContent = item.title;

        const tArtist = document.createElement('div');
        tArtist.className = 'ytm-artist';
        tArtist.textContent = item.author || 'Artista';

        meta.append(tTitle, tArtist);

        const time = document.createElement('div');
        time.className = 'ytm-time';
        time.textContent = item.duration || '';

        const add = document.createElement('div');
        add.className = 'ytm-add';
        add.textContent = '+';

        row.append(cover, meta, time, add);
        row.onclick = () => addSearchItem(item);
        searchResultsEl.appendChild(row);
    });
}

function addSearchItem(item) {
    if (!partyMember && !isDriverState) {
        message.style.color = '#ff9f0a';
        message.textContent = '🔒 Solo el conductor puede añadir canciones.';
        return;
    }

    hideSearchResults();
    urlInput.value = '';
    updateAddBtnLabel();

    if (partyMember) {
        sendTracksToParty([item]);
        return;
    }

    enqueueLocalTracks([item], 'Añadido a la cola de CarPlay.');
}

async function runInternalSearch(query) {
    const token = ++searchToken;
    if (addSectionEl) addSectionEl.classList.add('is-searching');
    if (searchResultsEl) {
        searchResultsEl.classList.remove('hidden');
        searchResultsEl.innerHTML = '<div class="search-list-head"><span>Buscando…</span></div>';
    }
    message.style.color = 'rgba(255,255,255,0.7)';
    message.textContent = '';

    const items = await fetchSearchVideos(query);
    if (token !== searchToken) return;

    if (!items.length) {
        hideSearchResults();
        message.style.color = '#ff453a';
        message.textContent = 'No se encontraron canciones. Prueba otro nombre o pega un enlace.';
        return;
    }

    renderSearchResults(items);
    message.style.color = 'rgba(255,255,255,0.7)';
    message.textContent = '';
}

async function addUrl() {
    if (!partyMember && !isDriverState) {
        message.style.color = '#ff9f0a';
        message.textContent = '🔒 Solo el conductor puede añadir canciones.';
        return;
    }

    const raw = urlInput.value.trim();
    if (!raw) return;

    if (!looksLikeYouTubeInput(raw)) {
        if (searchTimer) {
            clearTimeout(searchTimer);
            searchTimer = null;
        }
        await runInternalSearch(raw);
        return;
    }

    hideSearchResults();
    const url = normalizeYouTubeInput(raw);
    const playlistId = extractYouTubePlaylistId(url);
    const videoId = extractYouTubeId(url);

    if (playlistId) {
        message.style.color = 'rgba(255,255,255,0.7)';
        message.textContent = 'Cargando las primeras 10 canciones de la Playlist (FIFO)...';

        let playlistItems = await fetchPlaylistItems(playlistId);

        if (playlistItems && playlistItems.length > 0) {
            playlistItems = playlistItems.slice(0, 10);

            if (partyMember) {
                urlInput.value = '';
                updateAddBtnLabel();
                sendTracksToParty(playlistItems.slice(0, 10));
                return;
            }

            urlInput.value = '';
            updateAddBtnLabel();
            enqueueLocalTracks(playlistItems, `Se añadieron ${playlistItems.length} canciones (Cola FIFO).`);
            return;
        } else if (!videoId) {
            message.style.color = '#ff453a';
            message.textContent = 'No se pudieron cargar las canciones de la Playlist.';
            return;
        }
    }

    if (!videoId) {
        message.style.color = '#ff453a';
        message.textContent = 'Enlace de YouTube no válido.';
        return;
    }

    message.style.color = 'rgba(255,255,255,0.7)';
    message.textContent = 'Obteniendo canción...';

    const meta = await fetchMetadata(url, videoId);
    const newItem = {
        id: videoId,
        url,
        title: meta.title,
        author: meta.author
    };

    urlInput.value = '';
    updateAddBtnLabel();

    if (partyMember) {
        sendTracksToParty([newItem]);
        return;
    }

    enqueueLocalTracks([newItem], 'Añadido a la cola de CarPlay.');
}

function removeFromQueue(index) {
    if (index === currentIndex) {
        player?.stopVideo();
        currentIndex = -1;
        resetTrackUI();
        broadcastSync(false);
    } else if (index < currentIndex) {
        currentIndex--;
    }

    queue.splice(index, 1);
    renderQueue();
}

function resetTrackUI() {
    isGameRadioActive = false;
    currentSyncedId = null;
    currentSyncedNetId = null;
    titleEl.textContent = 'Sin reproducción';
    urlText.textContent = document.documentElement.dataset.theme === 'spotify' ? 'Reproduciendo en Spotify' : 'Reproduciendo en iFruit';
    hudTitle.textContent = 'Sin reproducción';
    hudArtist.textContent = document.documentElement.dataset.theme === 'spotify' ? 'Reproduciendo en Spotify' : 'Reproduciendo en iFruit';

    clearNowPlayingArt('♪');

    progress.value = 0;
    hudProgressFill.style.width = '0%';
    currentEl.textContent = '0:00';
    durationEl.textContent = '0:00';

    playIcon.textContent = '▶';
    updateEqAnimation(false);
}

function triggerTrackChangeAnimation() {
    const animEls = [titleEl, urlText, coverEl, hudTitle, hudArtist, hudCover];
    animEls.forEach(el => el && el.classList.add('track-changing'));

    if (hudWidget) {
        hudWidget.classList.remove('hud-pulse');
        void hudWidget.offsetWidth;
        hudWidget.classList.add('hud-pulse');
    }

    setTimeout(() => {
        animEls.forEach(el => el && el.classList.remove('track-changing'));
        if (coverEl) {
            coverEl.classList.add('track-bump');
            setTimeout(() => coverEl.classList.remove('track-bump'), 400);
        }
        if (hudCover) {
            hudCover.classList.add('track-bump');
            setTimeout(() => hudCover.classList.remove('track-bump'), 400);
        }
    }, 160);
}

function playIndex(index) {
    if (!queue[index]) return;

    isGameRadioActive = false;
    currentIndex = index;
    const item = queue[index];
    triggerTrackChangeAnimation();

    titleEl.textContent = item.title;
    urlText.textContent = item.author || 'Reproduciendo en iFruit';
    hudTitle.textContent = item.title;
    hudArtist.textContent = item.author || 'Reproduciendo en iFruit';

    setNowPlayingArt(item.id);

    renderQueue();
    playDualAudio(item.id, 0, volume.value);
    broadcastSync(true);
    broadcastPartyQueue();
}

function onTrackEnded() {
    if (!queue.length || currentIndex < 0) return;

    // Repeat One (repeatMode === 2): repeat current track
    if (repeatMode === 2) {
        playIndex(currentIndex);
        return;
    }

    // Shuffle: pick a random other track
    if (isShuffle && queue.length > 1) {
        let rand = Math.floor(Math.random() * queue.length);
        if (rand === currentIndex) rand = (rand + 1) % queue.length;
        playIndex(rand);
        return;
    }

    // Next track exists in queue
    if (currentIndex < queue.length - 1) {
        playIndex(currentIndex + 1);
        return;
    }

    // End of queue reached:
    if (repeatMode === 1) {
        // Repeat All: loop back to first track
        playIndex(0);
    } else {
        // Repeat OFF (default 0): STOP PLAYBACK AND DO NOT LOOP!
        stopDualAudio();
        currentIndex = -1;
        resetTrackUI();
        renderQueue();
        broadcastSync(false);
        broadcastPartyQueue();
    }
}

function playNext() {
    if (!queue.length) return;

    if (repeatMode === 2 && currentIndex >= 0) {
        playIndex(currentIndex);
        return;
    }

    if (isShuffle && queue.length > 1) {
        let rand = Math.floor(Math.random() * queue.length);
        if (rand === currentIndex) rand = (rand + 1) % queue.length;
        playIndex(rand);
        return;
    }

    playIndex((currentIndex + 1) % queue.length);
}

function playPrevious() {
    if (!queue.length) return;
    playIndex((currentIndex - 1 + queue.length) % queue.length);
}

function togglePlay() {
    if (currentIndex < 0) return;

    const isPlaying = (playerReady && player) ? player.getPlayerState() === YT.PlayerState.PLAYING : (h5Audio && !h5Audio.paused);
    if (isPlaying) {
        stopDualAudio();
        broadcastSync(false);
    } else {
        if (queue[currentIndex]) {
            const currentPos = (playerReady && player) ? player.getCurrentTime() : (h5Audio ? h5Audio.currentTime : 0);
            playDualAudio(queue[currentIndex].id, currentPos, volume.value);
            broadcastSync(true);
        }
    }
}

shuffleBtn.onclick = () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
};

repeatBtn.onclick = () => {
    repeatMode = (repeatMode + 1) % 3; // 0: Off, 1: Repeat All, 2: Repeat One
    repeatBtn.classList.toggle('active', repeatMode > 0);
    repeatBtn.title = repeatMode === 2 ? 'Repetir Una' : (repeatMode === 1 ? 'Repetir Todo' : 'Modo Repetir');
};

muteBtn.onclick = () => {
    isMuted = !isMuted;
    if (isMuted) {
        lastVolume = Number(volume.value);
        volume.value = 0;
        if (playerReady && player) player.setVolume(0);
    } else {
        volume.value = lastVolume || 70;
        if (playerReady && player) player.setVolume(Number(volume.value));
    }
    broadcastSync();
};

function updatePlayerUI() {
    if (!playerReady) return;

    const state = player.getPlayerState();
    const isPlaying = (state === YT.PlayerState.PLAYING);

    if (isPlaying) {
        playIcon.textContent = '❚❚';
    } else {
        playIcon.textContent = '▶';
    }
    updateEqAnimation(isPlaying);

    try {
        const vData = player.getVideoData();
        if (vData && vData.title && queue[currentIndex]) {
            if (queue[currentIndex].title !== vData.title) {
                queue[currentIndex].title = vData.title;
                if (vData.author) queue[currentIndex].author = vData.author;
                titleEl.textContent = vData.title;
                hudTitle.textContent = vData.title;
                urlText.textContent = vData.author || 'Reproduciendo desde YouTube';
                renderQueue();
                broadcastSync();
            }
        }
    } catch (_) {}

    const total = player.getDuration();
    const now = player.getCurrentTime();

    if (total > 0) {
        const pct = (now / total) * 100;
        progress.value = pct;
        hudProgressFill.style.width = `${pct}%`;
        currentEl.textContent = formatTime(now);
        durationEl.textContent = formatTime(total);
    }
}

function loadYouTubeAPI() {
    if (document.getElementById('youtube-api')) return;

    const script = document.createElement('script');
    script.id = 'youtube-api';
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
}

window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('youtubePlayer', {
        height: '1',
        width: '1',
        videoId: (window.pendingVideo && window.pendingVideo.id) ? window.pendingVideo.id : (typeof window.pendingVideo === 'string' ? window.pendingVideo : ''),
        playerVars: {
            autoplay: 1,
            controls: 0,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1
        },
        events: {
            onReady: () => {
                playerReady = true;
                if (window.pendingVideo) {
                    const videoObj = (typeof window.pendingVideo === 'object') ? window.pendingVideo : { id: window.pendingVideo, startPos: 0, volume: 70 };
                    player.loadVideoById(videoObj.id, videoObj.startPos || 0);
                    player.setVolume(isMuted ? 0 : (videoObj.volume || Number(volume.value)));
                    window.pendingVideo = null;
                } else {
                    player.setVolume(isMuted ? 0 : Number(volume.value));
                }

                if (progressTimer) clearInterval(progressTimer);
                progressTimer = setInterval(updatePlayerUI, 500);
            },
            onStateChange: (event) => {
                // CRITICAL FIX: Only the driver with active queue handles track transitions and sync!
                if (currentIndex >= 0 && isDriverState && !partyMember) {
                    if (event.data === YT.PlayerState.ENDED) {
                        onTrackEnded();
                    } else if (event.data === YT.PlayerState.PLAYING) {
                        broadcastSync(true);
                    } else if (event.data === YT.PlayerState.PAUSED) {
                        broadcastSync(false);
                    }
                }
                updatePlayerUI();
            }
        }
    });
};

document.getElementById('addBtn').onclick = addUrl;
document.getElementById('playBtn').onclick = togglePlay;
document.getElementById('nextBtn').onclick = () => {
    if (partyMember) {
        nui('partySkip', { dir: 1 });
        return;
    }
    playNext();
};
document.getElementById('prevBtn').onclick = () => {
    if (partyMember) {
        nui('partySkip', { dir: -1 });
        return;
    }
    playPrevious();
};
document.getElementById('closeBtn').onclick = () => nui('close');
document.getElementById('hudOpenBtn').onclick = () => {
    nui('getVehicle');
    app.classList.remove('hidden');
    hudWidget.classList.add('hidden');
};

document.getElementById('clearBtn').onclick = () => {
    queue = [];
    currentIndex = -1;
    stopDualAudio();
    resetTrackUI();
    renderQueue();
    broadcastSync(false);
    broadcastPartyQueue();
};

volume.oninput = () => {
    isMuted = false;
    updateDualVolume(Number(volume.value));
    if (!partyMember) broadcastSync();
};

progress.oninput = () => {
    const targetPos = (Number(progress.value) / 100) * (playerReady && player ? player.getDuration() : (h5Audio ? h5Audio.duration : 0));
    syncDualTime(targetPos);
};

function setTypingLock(active) {
    nui('setTyping', { active: !!active });
}

function bindTypingLock(el) {
    if (!el) return;
    el.addEventListener('focus', () => setTypingLock(true));
    el.addEventListener('blur', () => setTypingLock(false));
    el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (el === urlInput && e.key === 'Enter') addUrl();
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('keypress', (e) => e.stopPropagation());
}

bindTypingLock(urlInput);
bindTypingLock(document.getElementById('partyCodeInput'));
bindTypingLock(document.getElementById('partyIdInput'));

urlInput.addEventListener('input', () => {
    updateAddBtnLabel();
    const raw = urlInput.value.trim();
    if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = null;
    }
    if (!raw || looksLikeYouTubeInput(raw) || raw.length < 2) {
        if (!raw || looksLikeYouTubeInput(raw)) hideSearchResults();
        return;
    }
    if (!partyMember && !isDriverState) return;
    searchTimer = setTimeout(() => {
        runInternalSearch(raw);
    }, 180);
});

updateAddBtnLabel();

if (h5Audio) {
    h5Audio.addEventListener('ended', () => {
        if (currentIndex >= 0 && isDriverState && !partyMember) {
            onTrackEnded();
        }
    });
}

window.addEventListener('message', (event) => {
    const data = event.data;

    if (data.action === 'open') {
        app.classList.remove('hidden');
        hudWidget.classList.add('hidden');
        nui('getVehicle').then(res => res?.json?.()).then(vData => {
            if (vData) {
                const tag = vData.isDriver ? '' : ' (Pasajero)';
                if (vData.vehicle) {
                    vehiclePlate.textContent = `${vData.modelName || 'Vehículo'} [${vData.vehicle}]${tag}`;
                }
                setDriverMode(vData.isDriver);
                applyPartyLock();
            }
        });
    }

    if (data.action === 'searchResults') {
        const waiter = searchWaiters[data.reqId];
        if (waiter) waiter(data.items || []);
    }

    if (data.action === 'close') {
        app.classList.add('hidden');
        setTypingLock(false);
        hideSearchResults();
        if (isInVehicleState || partyTrackId) {
            hudWidget.classList.remove('hidden');
        }
    }

    if (data.action === 'setVehicleState') {
        isInVehicleState = data.inVehicle;
        if (isInVehicleState) {
            if (app.classList.contains('hidden')) {
                hudWidget.classList.remove('hidden');
            }
        } else if (!partyState) {
            hudWidget.classList.add('hidden');
            app.classList.add('hidden');
        } else if (partyTrackId && app.classList.contains('hidden')) {
            hudWidget.classList.remove('hidden');
        }
    }

    if (data.action === 'updateGameRadio') {
        const isYouTubePlaying = (playerReady && player && player.getPlayerState() === YT.PlayerState.PLAYING) || (h5Audio && !h5Audio.paused);
        if (data.isRadioOn && !isYouTubePlaying) {
            if (hudTitle.textContent !== data.stationName) {
                triggerTrackChangeAnimation();
            }
            isGameRadioActive = true;
            hudTitle.textContent = data.stationName;
            hudArtist.textContent = 'Radio de GTA V';
            titleEl.textContent = data.stationName;
            urlText.textContent = 'Radio de GTA V';
            clearNowPlayingArt('📻');
            updateEqAnimation(true);
        } else if (!data.isRadioOn && isGameRadioActive) {
            isGameRadioActive = false;
            if (!isYouTubePlaying && currentIndex < 0) {
                resetTrackUI();
            }
        }
    }

    if (data.action === 'setSpatialAttenuation') {
        const track = data.trackData;
        const vol = isMuted ? 0 : (data.volume || 0);
        const isDriver = data.isDriver;
        const isPassenger = data.isPassenger;

        if (partyMember && partyTrackId) return;

        // DRIVER with their own queue active: do NOT override their volume or playback
        // The driver controls their own audio entirely via the CarPlay UI
        if (isDriver && currentIndex >= 0) {
            return;
        }

        // PASSENGER or NEARBY PLAYER: handle synced audio from the vehicle
        if (track && track.id && track.isPlaying && vol > 0) {
            // Calculate what second of the song should be playing right now
            // serverTime = os.time() when the track started on the server
            // startPosition = the position in seconds when the track started
            // estimatedServerTime = client's estimate of current server time
            const elapsed = (data.estimatedServerTime && track.serverTime)
                ? Math.max(0, data.estimatedServerTime - track.serverTime)
                : 0;
            const targetPos = (track.startPosition || 0) + elapsed;

            // Stop playback if track duration has already passed
            if (track.duration && track.duration > 0 && targetPos >= track.duration + 1.5) {
                if (currentSyncedId !== null) {
                    currentSyncedId = null;
                    currentSyncedNetId = null;
                    stopDualAudio();
                    resetTrackUI();
                }
                return;
            }

            if (currentSyncedId !== track.id) {
                // New track - load it
                currentSyncedId = track.id;
                currentSyncedNetId = data.netId;

                triggerTrackChangeAnimation();
                titleEl.textContent = track.title || 'Audio de YouTube';
                urlText.textContent = track.author || 'Reproduciendo en iFruit';
                hudTitle.textContent = track.title || 'Audio de YouTube';
                hudArtist.textContent = track.author || 'Reproduciendo en iFruit';

                setNowPlayingArt(track.id);

                updateEqAnimation(true);
                playDualAudio(track.id, targetPos, vol);
            } else {
                // Same track - update volume and sync time
                updateDualVolume(vol);
                syncDualTime(targetPos);

                if (h5Audio && h5Audio.paused && !h5Audio.ended && vol > 0 && h5Audio.src) {
                    h5Audio.play().catch(() => {});
                }

                hudTitle.textContent = track.title || 'Audio de YouTube';
                hudArtist.textContent = track.author || 'Reproduciendo en iFruit';
                updateEqAnimation(true);
            }

            // If passenger in vehicle, ensure HUD widget is visible
            if ((isPassenger || data.isInVehicle) && app.classList.contains('hidden')) {
                hudWidget.classList.remove('hidden');
            }

            // If passenger, lock controls so they can't change the music
            if (isPassenger) {
                setDriverMode(false);
            }
        } else {
            // No vehicle nearby is playing audio or out of range
            if (currentSyncedId !== null) {
                currentSyncedId = null;
                currentSyncedNetId = null;
                stopDualAudio();
                resetTrackUI();
            }
        }
    }

    if (data.action === 'partyState') {
        const wasMember = partyMember;
        partyState = data.party || null;
        partyMember = !!(partyState && !partyState.isHost);
        if (tabPartyBtn) tabPartyBtn.classList.toggle('party-live', !!partyState);
        renderParty();
        applyPartyLock();
        if (wasMember && !partyMember) restoreAfterParty();
        if (partyState && partyState.isHost && viewParty && !viewParty.classList.contains('hidden')) {
            nui('partyNearby');
        }
    }

    if (data.action === 'partyResult') {
        const idle = !partyState;
        showPartyMessage(data.message || '', data.ok, idle);
    }

    if (data.action === 'partyNearby') {
        renderNearby(data.players || []);
    }

    if (data.action === 'partyInvite') {
        const toast = document.getElementById('partyToast');
        const text = document.getElementById('partyToastText');
        if (text) text.textContent = `${data.hostName || 'Alguien'} te invitó. Y para aceptar, N para rechazar.`;
        if (toast) toast.classList.remove('hidden');
    }

    if (data.action === 'partyInviteClear') {
        const toast = document.getElementById('partyToast');
        if (toast) toast.classList.add('hidden');
    }

    if (data.action === 'partyTrack') {
        handlePartyTrack(data);
    }

    if (data.action === 'partyQueue' && partyMember) {
        queue = Array.isArray(data.queue) ? data.queue : [];
        currentIndex = Number.isInteger(data.index) ? data.index : -1;
        renderQueue();
    }

    if (data.action === 'partyHostControl' && partyState && partyState.isHost) {
        if (data.cmd === 'add' && Array.isArray(data.items)) {
            const start = queue.length;
            data.items.forEach(item => {
                if (item && item.id) queue.push(item);
            });
            renderQueue();
            if (currentIndex < 0 && queue[start]) playIndex(start);
            else broadcastPartyQueue();
        } else if (data.cmd === 'next') {
            playNext();
        } else if (data.cmd === 'prev') {
            playPrevious();
        } else if (data.cmd === 'play' && queue[data.index]) {
            playIndex(data.index);
        }
    }

    if (data.action === 'openParty') {
        switchTab(tabPartyBtn, viewParty);
    }
});

function showPartyMessage(text, ok, idle) {
    const el = document.getElementById(idle ? 'partyMsg' : 'partyLiveMsg');
    if (!el) return;
    el.style.color = ok ? '#30d158' : '#ff453a';
    el.textContent = text || '';
}

function applyPartyLock() {
    if (!partyMember) return;
    setDriverMode(false);
    ['addBtn', 'nextBtn', 'prevBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
    });
    if (urlInput) {
        urlInput.disabled = false;
        urlInput.placeholder = 'Añade una canción a la party...';
    }
    if (message) {
        message.style.color = '#bf5af2';
        message.textContent = `Party de ${partyState.hostName || 'tu grupo'}. Puedes añadir y saltar canciones.`;
    }
}

function restoreAfterParty() {
    partyTrackId = null;
    if (currentIndex >= 0 && queue[currentIndex]) {
        playIndex(currentIndex);
        return;
    }
    stopDualAudio();
    resetTrackUI();
}

function renderParty() {
    const idle = document.getElementById('partyIdle');
    const live = document.getElementById('partyLive');
    const membersEl = document.getElementById('partyMembers');
    const hostTools = document.getElementById('partyHostTools');
    if (!idle || !live) return;

    if (!partyState) {
        idle.classList.remove('hidden');
        live.classList.add('hidden');
        return;
    }

    idle.classList.add('hidden');
    live.classList.remove('hidden');
    const title = document.getElementById('partyTitle');
    const code = document.getElementById('partyCodeLabel');
    if (title) title.textContent = partyState.isHost ? 'Tu party' : `Party de ${partyState.hostName || 'un amigo'}`;
    if (code) code.textContent = `Código ${partyState.code || ''}`;
    if (hostTools) hostTools.classList.toggle('hidden', !partyState.isHost);

    if (!membersEl) return;
    membersEl.innerHTML = '';
    (partyState.members || []).forEach(member => {
        const row = document.createElement('div');
        row.className = 'party-row';
        const info = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'party-row-name';
        name.textContent = member.name || `ID ${member.id}`;
        const meta = document.createElement('div');
        meta.className = 'party-row-meta';
        meta.textContent = member.host ? 'Anfitrión' : `ID ${member.id}`;
        info.append(name, meta);
        row.appendChild(info);
        if (partyState.isHost && !member.host) {
            const kick = document.createElement('button');
            kick.textContent = 'Sacar';
            kick.onclick = () => nui('partyKick', { targetId: member.id });
            row.appendChild(kick);
        }
        membersEl.appendChild(row);
    });
}

function renderNearby(players) {
    const list = document.getElementById('partyNearby');
    if (!list) return;
    list.innerHTML = '';
    if (!players.length) {
        list.innerHTML = '<div class="party-row-meta">Nadie cerca. También puedes invitar por ID.</div>';
        return;
    }
    players.forEach(player => {
        const row = document.createElement('div');
        row.className = 'party-row';
        const info = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'party-row-name';
        name.textContent = player.name || `ID ${player.id}`;
        const meta = document.createElement('div');
        meta.className = 'party-row-meta';
        meta.textContent = `ID ${player.id} · ${player.dist}m`;
        info.append(name, meta);
        const invite = document.createElement('button');
        invite.textContent = 'Invitar';
        invite.onclick = () => nui('partyInvite', { targetId: player.id });
        row.append(invite, info);
        row.insertBefore(info, invite);
        list.appendChild(row);
    });
}

function handlePartyTrack(data) {
    if (!partyMember) return;
    const track = data.track;

    if (!track || !track.id || !track.isPlaying) {
        if (partyTrackId !== null) {
            partyTrackId = null;
            stopDualAudio();
            resetTrackUI();
        }
        return;
    }

    const elapsed = (data.estimatedServerTime && track.serverTime)
        ? Math.max(0, data.estimatedServerTime - track.serverTime)
        : 0;
    const targetPos = (track.startPosition || 0) + elapsed;
    const vol = isMuted ? 0 : Number(volume.value);

    if (track.duration && track.duration > 0 && targetPos >= track.duration + 1.5) {
        if (partyTrackId !== null) {
            partyTrackId = null;
            stopDualAudio();
            resetTrackUI();
        }
        return;
    }

    if (partyTrackId !== track.id) {
        partyTrackId = track.id;
        currentSyncedId = null;
        triggerTrackChangeAnimation();
        titleEl.textContent = track.title || 'Audio de YouTube';
        urlText.textContent = track.author || 'Party Music';
        hudTitle.textContent = track.title || 'Audio de YouTube';
        hudArtist.textContent = `Party · ${partyState && partyState.hostName ? partyState.hostName : 'grupo'}`;
        setNowPlayingArt(track.id);
        updateEqAnimation(true);
        playDualAudio(track.id, targetPos, vol);
    } else {
        updateDualVolume(vol);
        syncDualTime(targetPos);
        updateEqAnimation(true);
    }

    if (app.classList.contains('hidden')) {
        hudWidget.classList.remove('hidden');
    }
}

document.getElementById('partyCreateBtn').onclick = () => nui('partyCreate');
document.getElementById('partyJoinBtn').onclick = () => {
    const code = (document.getElementById('partyCodeInput').value || '').trim().toUpperCase();
    if (!code) return;
    nui('partyJoin', { code });
};
document.getElementById('partyLeaveBtn').onclick = () => nui('partyLeave');
document.getElementById('partyRefreshBtn').onclick = () => nui('partyNearby');
document.getElementById('partyInviteIdBtn').onclick = () => {
    const targetId = Number(document.getElementById('partyIdInput').value);
    if (!targetId) return;
    nui('partyInvite', { targetId });
};
document.getElementById('partyAcceptBtn').onclick = () => nui('partyRespond', { accept: true });
document.getElementById('partyDeclineBtn').onclick = () => nui('partyRespond', { accept: false });
document.getElementById('partyCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('partyJoinBtn').click();
});

renderQueue();
loadYouTubeAPI();
