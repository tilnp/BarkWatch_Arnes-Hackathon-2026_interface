const SLOVENIA_CENTER = [14.9955, 46.1512];
const INITIAL_ZOOM = 8;

const DISPLAY_FIELDS = [
    'ggo', 'odsek', 'povrsina', 'relief', 'lega', 'nagib',
    'kamnina', 'kamnit', 'skalnat', 'geometry', 'negovan', 'pompov',
    'lzigl', 'lzlst', 'lzsku', 'etigl', 'etlst', 'etsku'
];

const MONTH_PALETTES = [
    ['#e11d48', '#fb7185', '#fdba74', '#facc15', '#22c55e'],
    ['#be123c', '#f43f5e', '#f97316', '#a3e635', '#14b8a6'],
    ['#c026d3', '#a855f7', '#6366f1', '#0ea5e9', '#06b6d4'],
    ['#7c3aed', '#8b5cf6', '#3b82f6', '#22d3ee', '#34d399'],
    ['#2563eb', '#60a5fa', '#38bdf8', '#2dd4bf', '#4ade80'],
    ['#0f766e', '#14b8a6', '#22c55e', '#84cc16', '#eab308'],
    ['#15803d', '#4ade80', '#facc15', '#f97316', '#ef4444'],
    ['#b45309', '#f59e0b', '#f97316', '#fb7185', '#f43f5e'],
    ['#dc2626', '#ef4444', '#f97316', '#f59e0b', '#84cc16'],
    ['#9333ea', '#c084fc', '#38bdf8', '#2dd4bf', '#22c55e'],
    ['#1d4ed8', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981'],
    ['#334155', '#64748b', '#94a3b8', '#60a5fa', '#a78bfa']
];

const TILE_URL = `${window.location.origin}/tiles/{z}/{x}/{y}`;

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            satellite: {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: 'Esri World Imagery'
            },
            odseki: {
                type: 'vector',
                tiles: [TILE_URL],
                minzoom: 8,
                maxzoom: 14
            }
        },
        layers: [
            {
                id: 'satellite-layer',
                type: 'raster',
                source: 'satellite'
            },
            {
                id: 'odseki-fill',
                type: 'fill',
                source: 'odseki',
                'source-layer': 'odsek',
                paint: {
                    'fill-color': '#FF0000',
                    'fill-opacity': 0.45
                }
            },
            {
                id: 'odseki-outline',
                type: 'line',
                source: 'odseki',
                'source-layer': 'odsek',
                paint: {
                    'line-color': '#111827',
                    'line-width': 0.6,
                    'line-opacity': 0.75
                }
            },
            {
                id: 'odseki-selected-outline',
                type: 'line',
                source: 'odseki',
                'source-layer': 'odsek',
                filter: ['==', ['to-string', ['get', 'odsek']], ''],
                paint: {
                    'line-color': '#22d3ee',
                    'line-width': 3,
                    'line-opacity': 1
                }
            }
        ]
    },
    center: SLOVENIA_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: INITIAL_ZOOM,
    maxZoom: 16
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

const searchInput = document.getElementById('odsek-search');
const searchBtn = document.getElementById('search-btn');
const suggestionsEl = document.getElementById('suggestions');
const selectedOdsekEl = document.getElementById('selected-odsek');
const detailsEl = document.getElementById('odsek-details');
const monthSlider = document.getElementById('month-slider');
const monthLabel = document.getElementById('month-label');

let currentSuggestions = [];
let suggestionsRequestCounter = 0;

function buildColorExpression(monthIndex) {
    const palette = MONTH_PALETTES[(monthIndex - 1) % MONTH_PALETTES.length];
    return [
        'let', 'bucket', ['%', ['abs', ['to-number', ['get', 'odsek'], 0]], 5],
        [
            'match', ['var', 'bucket'],
            0, palette[0],
            1, palette[1],
            2, palette[2],
            3, palette[3],
            palette[4]
        ]
    ];
}

function updateMonthStyle() {
    const month = Number(monthSlider.value);
    monthLabel.textContent = `Mesec ${month}`;

    if (map.getLayer('odseki-fill')) {
        map.setPaintProperty('odseki-fill', 'fill-color', buildColorExpression(month));
    }
}

function isValidLonLatBbox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return false;
    return (
        bbox[0] >= -180 && bbox[0] <= 180 &&
        bbox[2] >= -180 && bbox[2] <= 180 &&
        bbox[1] >= -90 && bbox[1] <= 90 &&
        bbox[3] >= -90 && bbox[3] <= 90
    );
}

function coordinatesBbox(coords, acc) {
    if (!Array.isArray(coords)) return acc;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const x = coords[0];
        const y = coords[1];
        return [
            Math.min(acc[0], x),
            Math.min(acc[1], y),
            Math.max(acc[2], x),
            Math.max(acc[3], y)
        ];
    }
    for (const item of coords) {
        acc = coordinatesBbox(item, acc);
    }
    return acc;
}

function findBoundsInLoadedTiles(odsekId) {
    if (!map.isStyleLoaded()) return null;

    const features = map.querySourceFeatures('odseki', { sourceLayer: 'odsek' });
    const found = features.find((feature) => String(feature.properties?.odsek) === String(odsekId));
    if (!found || !found.geometry) return null;

    const bbox = coordinatesBbox(found.geometry.coordinates, [Infinity, Infinity, -Infinity, -Infinity]);
    if (!Number.isFinite(bbox[0])) return null;

    return bbox;
}

function fitToBbox(bbox) {
    map.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: 70, duration: 700 }
    );
}

function truncateValue(value, maxLen = 180) {
    const text = String(value ?? '');
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)} ...`;
}

function renderDetailsTable(data) {
    if (!data) {
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Podatki niso na voljo.';
        return;
    }

    const rows = DISPLAY_FIELDS.map((field) => {
        const value = data[field] ?? '';
        const shown = field === 'geometry' ? truncateValue(value) : String(value);
        return `<tr><th>${field}</th><td title="${String(value).replace(/"/g, '&quot;')}">${shown || '-'}</td></tr>`;
    }).join('');

    detailsEl.classList.remove('empty');
    detailsEl.innerHTML = `<table class="details-table"><tbody>${rows}</tbody></table>`;
}

function renderSuggestions(items) {
    currentSuggestions = items;
    if (!items.length) {
        suggestionsEl.innerHTML = '';
        return;
    }

    suggestionsEl.innerHTML = items
        .map((id) => `<button class="suggestion-item" type="button" data-odsek="${id}">${id}</button>`)
        .join('');
}

async function fetchSuggestions(query) {
    const requestId = ++suggestionsRequestCounter;
    const response = await fetch(`/api/odseki/suggest?q=${encodeURIComponent(query)}`);
    if (!response.ok) return;
    const payload = await response.json();

    if (requestId !== suggestionsRequestCounter) return;
    renderSuggestions(payload.suggestions || []);
}

async function fetchOdsek(odsekId) {
    const response = await fetch(`/api/odseki/${encodeURIComponent(odsekId)}`);
    if (!response.ok) return null;
    return response.json();
}

function setSelectedOdsekFilter(odsekId) {
    if (!map.getLayer('odseki-selected-outline')) return;
    map.setFilter('odseki-selected-outline', ['==', ['to-string', ['get', 'odsek']], String(odsekId)]);
}

async function selectOdsek(odsekId) {
    if (!odsekId) return;

    const cleanId = String(odsekId).trim();
    if (!cleanId) return;

    searchInput.value = cleanId;
    suggestionsEl.innerHTML = '';

    const payload = await fetchOdsek(cleanId);
    if (!payload || !payload.data) {
        selectedOdsekEl.textContent = `Odsek ${cleanId} ni najden.`;
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Ni podatkov za izbran odsek.';
        return;
    }

    selectedOdsekEl.textContent = `Izbran odsek: ${cleanId}`;
    renderDetailsTable(payload.data);
    setSelectedOdsekFilter(cleanId);

    let moved = false;
    if (isValidLonLatBbox(payload.data.bbox)) {
        fitToBbox(payload.data.bbox);
        moved = true;
    }

    if (!moved) {
        const loadedBounds = findBoundsInLoadedTiles(cleanId);
        if (loadedBounds) {
            fitToBbox(loadedBounds);
        }
    }
}

searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (query.length < 1) {
        renderSuggestions([]);
        return;
    }
    fetchSuggestions(query);
});

searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        selectOdsek(searchInput.value);
    }
});

searchBtn.addEventListener('click', () => {
    selectOdsek(searchInput.value);
});

suggestionsEl.addEventListener('click', (event) => {
    const button = event.target.closest('.suggestion-item');
    if (!button) return;
    selectOdsek(button.dataset.odsek);
});

map.on('load', () => {
    const initialBounds = map.getBounds();
    map.setMaxBounds(initialBounds);

    updateMonthStyle();
});

monthSlider.addEventListener('input', updateMonthStyle);

map.on('click', 'odseki-fill', (event) => {
    const props = event.features?.[0]?.properties || {};
    if (!props.odsek) return;
    selectOdsek(String(props.odsek));
});

map.on('mouseenter', 'odseki-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'odseki-fill', () => {
    map.getCanvas().style.cursor = '';
});
