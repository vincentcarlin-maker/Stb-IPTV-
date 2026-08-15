import { Channel, EPGProgram, VODItem, TVSeries } from '../types/iptv';

export const DEMO_CHANNELS: Channel[] = [
  {
    id: 'fr24-fr',
    number: 1,
    name: 'France 24 HD (FR)',
    streamUrl: 'https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/France_24_logo.svg/300px-France_24_logo.svg.png',
    category: 'Information',
    epgId: 'fr24.fr',
    resolution: 'FHD',
    fps: 50,
    hasCatchup: true,
    catchupDays: 7,
    isFavorite: true,
  },
  {
    id: 'arte-fr',
    number: 2,
    name: 'ARTE HD',
    streamUrl: 'https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Arte_logo_2017.svg/320px-Arte_logo_2017.svg.png',
    category: 'Généraliste',
    epgId: 'arte.fr',
    resolution: 'FHD',
    fps: 50,
    hasCatchup: true,
    catchupDays: 7,
    isFavorite: true,
  },
  {
    id: 'euronews-fr',
    number: 3,
    name: 'Euronews Français HD',
    streamUrl: 'https://cdn-euronews.akamaized.net/live/eds/africanews-fr/25050/index.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Euronews_2016_logo.svg/320px-Euronews_2016_logo.svg.png',
    category: 'Information',
    epgId: 'euronews.fr',
    resolution: 'HD',
    fps: 30,
    hasCatchup: true,
  },
  {
    id: 'bfm-fr',
    number: 4,
    name: 'BFM TV 2 HD',
    streamUrl: 'https://d1ib1gsg71oarf.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-scp7wda722jph/BFM2_FR.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/BFMTV_2017_logo.svg/320px-BFMTV_2017_logo.svg.png',
    category: 'Information',
    epgId: 'tv5monde.fr',
    resolution: 'HD',
    fps: 30,
    hasCatchup: true,
  },
  {
    id: 'redbull-tv',
    number: 5,
    name: 'Red Bull TV HD',
    streamUrl: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Red_Bull_TV_logo.svg/320px-Red_Bull_TV_logo.svg.png',
    category: 'Sport',
    epgId: 'redbull.tv',
    resolution: 'FHD',
    fps: 60,
    hasCatchup: true,
    isFavorite: true,
  },
  {
    id: 'nasa-tv',
    number: 6,
    name: 'NASA TV HD (Public)',
    streamUrl: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/300px-NASA_logo.svg.png',
    category: 'Documentaires',
    epgId: 'nasa.tv',
    resolution: '4K',
    fps: 60,
    hasCatchup: true,
  },
  {
    id: '20min-fr',
    number: 7,
    name: '20 Minutes TV HD',
    streamUrl: 'https://live-20minutestv.digiteka.com/1961167769/index.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/20_minutes_logo.svg/320px-20_minutes_logo.svg.png',
    category: 'Information',
    epgId: 'bloomberg.tv',
    resolution: 'FHD',
    fps: 30,
  },
  {
    id: 'dw-fr',
    number: 8,
    name: 'Deutsche Welle (Français)',
    streamUrl: 'https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_logo.svg/320px-Deutsche_Welle_logo.svg.png',
    category: 'Information',
    epgId: 'dw.fr',
    resolution: 'HD',
    fps: 30,
  },
  {
    id: 'rakuten-action',
    number: 9,
    name: 'ADN Anime & Séries HD',
    streamUrl: 'https://d3b73b34o7cvkq.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-gz2sgqzp076kf/adn.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Rakuten_TV_logo.svg/320px-Rakuten_TV_logo.svg.png',
    category: 'Cinéma & Séries',
    epgId: 'rakuten.action',
    resolution: 'FHD',
    fps: 30,
    isFavorite: true,
  },
  {
    id: 'pluto-cinema-retro',
    number: 10,
    name: 'Cinéma Fiction HD',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Pluto_TV_logo_2020.svg/320px-Pluto_TV_logo_2020.svg.png',
    category: 'Cinéma & Séries',
    epgId: 'pluto.retro',
    resolution: 'HD',
    fps: 30,
  },
  {
    id: 'pluto-nature-docs',
    number: 11,
    name: 'Alpe d\'Huez Découverte & Nature',
    streamUrl: 'https://edge13.vedge.infomaniak.com/livecast/ik:adhtv/manifest.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Pluto_TV_logo_2020.svg/320px-Pluto_TV_logo_2020.svg.png',
    category: 'Documentaires',
    epgId: 'pluto.nature',
    resolution: 'FHD',
    fps: 30,
  },
  {
    id: 'pluto-kids-animation',
    number: 12,
    name: 'Toons Animation TV',
    streamUrl: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Pluto_TV_logo_2020.svg/320px-Pluto_TV_logo_2020.svg.png',
    category: 'Enfants & Jeunesse',
    epgId: 'pluto.kids',
    resolution: 'HD',
    fps: 30,
  },
  {
    id: 'clubbing-tv',
    number: 13,
    name: 'Clubbing TV Electronic HD',
    streamUrl: 'https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8',
    logo: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=150&auto=format&fit=crop&q=80',
    category: 'Musique',
    epgId: 'clubbing.tv',
    resolution: 'FHD',
    fps: 50,
  },
  {
    id: 'extreme-sports',
    number: 14,
    name: 'Africa 24 Sport & Live HD',
    streamUrl: 'https://africa24.vedge.infomaniak.com/livecast/ik:africa24sport/manifest.m3u8',
    logo: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=150&auto=format&fit=crop&q=80',
    category: 'Sport',
    epgId: 'extreme.tv',
    resolution: 'FHD',
    fps: 60,
  },
  {
    id: 'adult-midnight-club',
    number: 99,
    name: 'Midnight Pass Club +18',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    logo: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=150&auto=format&fit=crop&q=80',
    category: 'Adulte / +18',
    epgId: 'adult.midnight',
    resolution: '4K',
    fps: 60,
    isLocked: true,
  },
  {
    id: 'adult-lounge-xx',
    number: 100,
    name: 'Secret Lounge TV +18',
    streamUrl: 'https://test-streams.mux.dev/test_001/stream.m3u8',
    logo: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150&auto=format&fit=crop&q=80',
    category: 'Adulte / +18',
    epgId: 'adult.lounge',
    resolution: 'FHD',
    fps: 30,
    isLocked: true,
  }
];

export const CATEGORIES = [
  'Tous',
  'Favoris',
  'Généraliste',
  'Information',
  'Cinéma & Séries',
  'Sport',
  'Documentaires',
  'Enfants & Jeunesse',
  'Musique',
  'Adulte / +18',
];

// Helper to generate dynamic EPG programs relative to right now
export function generateDynamicEPG(channelId: string): EPGProgram[] {
  const now = Date.now();
  // Round to nearest 30 mins
  const baseTime = Math.floor(now / (30 * 60 * 1000)) * (30 * 60 * 1000) - 2 * 60 * 60 * 1000; // 2 hours in the past

  const programTemplates: Record<string, { title: string; desc: string; cat: string; rating: string; durMins: number }[]> = {
    'fr24-fr': [
      { title: 'Le Journal International', desc: 'Édition complète de l’actualité internationale avec nos correspondants à travers le monde.', cat: 'Information', rating: 'Tous publics', durMins: 30 },
      { title: 'Le Débat France 24', desc: 'Confrontation d’idées et décryptage des grands enjeux géopolitiques contemporains.', cat: 'Débat', rating: 'Tous publics', durMins: 45 },
      { title: 'Éco d’Ici et d’Ailleurs', desc: 'L’actualité économique mondiale, les marchés financiers et l’innovation.', cat: 'Économie', rating: 'Tous publics', durMins: 30 },
      { title: 'Grand Angle Reportage', desc: 'Immersion au cœur des crises et mutations qui façonnent la planète.', cat: 'Magazine', rating: 'Tous publics', durMins: 45 },
      { title: 'Journal de la Nuit Monde', desc: 'Synthèse des faits marquants des dernières 24 heures.', cat: 'Information', rating: 'Tous publics', durMins: 30 },
      { title: 'Revue de Presse Globale', desc: 'Le tour des unes de la presse internationale et des éditoriaux.', cat: 'Culture', rating: 'Tous publics', durMins: 30 },
    ],
    'arte-fr': [
      { title: 'Invitation au Voyage', desc: 'Un voyage poétique à la découverte des lieux qui ont inspiré les artistes et écrivains.', cat: 'Culture', rating: 'Tous publics', durMins: 45 },
      { title: 'Arte Journal & Économie', desc: 'Une perspective européenne et ouverte sur l’actualité politique et culturelle.', cat: 'Information', rating: 'Tous publics', durMins: 30 },
      { title: '28 Minutes - Le Grand Entretien', desc: 'Élisabeth Quin et son équipe passent l’actualité au crible avec rigueur et esprit critique.', cat: 'Talk-Show', rating: 'Tous publics', durMins: 45 },
      { title: 'Cinéma : Le Ruban Blanc', desc: 'Chef-d’œuvre dramatique réalisé par Michael Haneke. Palme d’Or Festival de Cannes.', cat: 'Cinéma', rating: '12+', durMins: 135 },
      { title: 'Tracks : Cultures Underground', desc: 'Le magazine des contre-cultures, des musiques électroniques et de l’art émergent.', cat: 'Musique', rating: 'Tous publics', durMins: 50 },
      { title: 'Mystères des Océans Profonds', desc: 'Documentaire scientifique en haute définition sur les abysses inexplorés.', cat: 'Documentaire', rating: 'Tous publics', durMins: 60 },
    ],
    'redbull-tv': [
      { title: 'Red Bull Rampage : Finale Live', desc: 'Les meilleurs riders VTT freeride du monde s’affrontent sur les falaises de l’Utah.', cat: 'Sport Extrême', rating: 'Tous publics', durMins: 90 },
      { title: 'The Horn : Sauvetage en Montagne', desc: 'Immersion avec les équipes de secours héliportées d’Air Zermatt dans les Alpes suisses.', cat: 'Documentaire', rating: 'Tous publics', durMins: 45 },
      { title: 'BC One World Final : Breakdance', desc: 'Le championnat du monde incontournable de Breaking en direct.', cat: 'Danse / Sport', rating: 'Tous publics', durMins: 75 },
      { title: 'Chasing the Storm : Wingsuit Tour', desc: 'Vol en rase-motte au-dessus des fjords norvégiens avec la team Red Bull Sky.', cat: 'Sport Extrême', rating: 'Tous publics', durMins: 40 },
    ],
    'nasa-tv': [
      { title: 'ISS Live Stream & Spacewalk', desc: 'Sortie extravéhiculaire en direct des astronautes de la Station Spatiale Internationale.', cat: 'Science', rating: 'Tous publics', durMins: 120 },
      { title: 'Artemis : Retour sur la Lune', desc: 'Documentaire complet sur le lanceur géant SLS et la capsule Orion pour la conquête lunaire.', cat: 'Documentaire', rating: 'Tous publics', durMins: 60 },
      { title: 'James Webb Space Telescope Discoveries', desc: 'Exploration des premières galaxies de l’univers et découverte d’exoplanètes habitables.', cat: 'Astronomie', rating: 'Tous publics', durMins: 45 },
    ],
    'rakuten-action': [
      { title: 'Inception 4K HDR', desc: 'Dom Cobb vole des secrets à l’intérieur du subconscient lors des rêves.', cat: 'Action / Sci-Fi', rating: '12+', durMins: 148 },
      { title: 'Mission Tactique : Traque Finale', desc: 'Une escouade d’élite infiltrée au cœur du territoire ennemi pour extraire un dignitaire.', cat: 'Action', rating: '16+', durMins: 105 },
      { title: 'Night Hunter : Assaut Urbain', desc: 'Un thriller palpitant où un détective affronte un syndicat du crime.', cat: 'Thriller', rating: '16+', durMins: 110 },
    ],
    'adult-midnight-club': [
      { title: 'Pass VIP Midnight +18', desc: 'Programme exclusif réservé aux adultes. Contrôle parental actif.', cat: 'Adulte', rating: '18+', durMins: 60 },
      { title: 'Private Glamour Night +18', desc: 'Émission de charme nocturne. Accès verrouillé par code PIN.', cat: 'Adulte', rating: '18+', durMins: 90 },
      { title: 'Sensual Lounge +18', desc: 'Diffusion continue nocturne pour adultes.', cat: 'Adulte', rating: '18+', durMins: 120 },
    ]
  };

  const defaultTemplates = [
    { title: 'Direct Live & Magazine Quotidien', desc: 'Émission en direct, reportages exclusifs, interviews et analyse des thématiques clés.', cat: 'Généraliste', rating: 'Tous publics', durMins: 45 },
    { title: 'Grand Format Documentaire', desc: 'Immersion exclusive et enquête approfondie.', cat: 'Documentaire', rating: 'Tous publics', durMins: 60 },
    { title: 'Soirée Cinéma & Divertissement', desc: 'Le grand rendez-vous divertissement et fiction de la soirée.', cat: 'Cinéma', rating: 'Tous publics', durMins: 90 },
    { title: 'Édition Spéciale de Nuit', desc: 'Tour d’horizon complet des événements et coulisses.', cat: 'Magazine', rating: 'Tous publics', durMins: 40 },
    { title: 'Le Récapitulatif Matinal', desc: 'Tout ce qu’il faut savoir pour bien démarrer la journée.', cat: 'Information', rating: 'Tous publics', durMins: 45 },
    { title: 'Culture & Tendances Show', desc: 'Musique, arts, technologies et nouveaux modes de vie.', cat: 'Culture', rating: 'Tous publics', durMins: 50 },
  ];

  const templates = programTemplates[channelId] || defaultTemplates;
  const programs: EPGProgram[] = [];

  let currentStart = baseTime;
  let idx = 0;

  // Generate 8 sequential programs covering past, now, and next 12 hours
  for (let i = 0; i < 8; i++) {
    const tmpl = templates[idx % templates.length];
    const durationMs = tmpl.durMins * 60 * 1000;
    const currentEnd = currentStart + durationMs;

    programs.push({
      id: `${channelId}-prog-${i}-${currentStart}`,
      channelId,
      title: tmpl.title,
      start: currentStart,
      end: currentEnd,
      description: tmpl.desc,
      category: tmpl.cat,
      rating: tmpl.rating,
      poster: `https://images.unsplash.com/photo-${1510000000000 + (i * 1234567) % 900000000}?w=400&auto=format&fit=crop&q=80`,
    });

    currentStart = currentEnd;
    idx++;
  }

  return programs;
}

export const DEMO_VOD_MOVIES: VODItem[] = [
  {
    id: 'vod-cosmos',
    title: 'Cosmos Laundromat (4K Open Movie)',
    streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80',
    backdrop: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop&q=80',
    category: 'Science-Fiction',
    rating: 'Tous publics',
    releaseYear: 2024,
    duration: '1h 42min',
    overview: 'Sur une île déserte et mystérieuse, un mouton mélancolique rencontre un étrange marchand qui lui offre une infinité de vies alternatives.',
    genre: ['Sci-Fi', 'Animation', 'Aventure'],
    director: 'Mathieu Auvray',
    cast: ['Pierre T.', 'Sarah L.'],
    isFavorite: true,
  },
  {
    id: 'vod-tears-of-steel',
    title: 'Tears of Steel (Sci-Fi VFX)',
    streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    poster: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
    backdrop: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&auto=format&fit=crop&q=80',
    category: 'Action & Sci-Fi',
    rating: '12+',
    releaseYear: 2023,
    duration: '2h 05min',
    overview: 'Dans un futur dystopique à Amsterdam, un groupe de scientifiques et de guerriers tente de reprogrammer le passé pour sauver la civilisation des robots.',
    genre: ['Action', 'Cyberpunk', 'VFX'],
    director: 'Ian Hubert',
    cast: ['Derek de Lint', 'Sergio Hasselbaink'],
  },
  {
    id: 'vod-sintel',
    title: 'Sintel : La Quête du Dragon',
    streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80',
    backdrop: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&auto=format&fit=crop&q=80',
    category: 'Fantastique & Aventure',
    rating: 'Tous publics',
    releaseYear: 2022,
    duration: '1h 35min',
    overview: 'Une jeune guerrière solitaire brave les montagnes enneigées et les dangers ancestraux pour retrouver son bébé dragon capturé par une bête colossale.',
    genre: ['Fantastique', 'Drame', 'Épique'],
    director: 'Colin Levy',
    cast: ['Halina Reijn', 'Thom Hoffman'],
    isFavorite: true,
  },
  {
    id: 'vod-big-buck-bunny',
    title: 'Big Buck Bunny Remastered',
    streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    poster: 'https://images.unsplash.com/photo-1535930749574-1399327ce78f?w=400&auto=format&fit=crop&q=80',
    category: 'Animation & Famille',
    rating: 'Tous publics',
    releaseYear: 2023,
    duration: '1h 15min',
    overview: 'Un gigantesque lapin pacifique décide de tendre des pièges hilarants et ingénieux aux petits rongeurs turbulents de la forêt.',
    genre: ['Comédie', 'Jeunesse', 'Animation'],
    director: 'Sacha Goedegebure',
  },
  {
    id: 'vod-midnight-sensations',
    title: 'Nuit Secrète & Mystères +18',
    streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    poster: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=400&auto=format&fit=crop&q=80',
    category: 'Adulte / +18',
    rating: '18+',
    releaseYear: 2024,
    duration: '1h 50min',
    overview: 'Thriller érotique nocturne. Contenu réservé exclusivement aux adultes. Contrôle parental actif.',
    genre: ['Adulte', 'Thriller'],
    isLocked: true,
  }
];

export const DEMO_SERIES: TVSeries[] = [
  {
    id: 'series-cyber-grid',
    title: 'Cyber Grid : Neo Paris 2088',
    poster: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80',
    backdrop: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop&q=80',
    category: 'Science-Fiction',
    rating: '16+',
    releaseYear: 2024,
    overview: 'Dans une mégapole saturée de données, une enquêtrice cyborg traque une intelligence artificielle clandestine qui s’infiltre dans les mémoires humaines.',
    genre: ['Cyberpunk', 'Enquête', 'Thriller'],
    totalSeasons: 2,
    isFavorite: true,
    seasons: [
      {
        seasonNumber: 1,
        title: 'Saison 1 : L’Éveil du Code',
        episodes: [
          { id: 'cg-s1e1', episodeNumber: 1, title: 'Épisode 1 - Le Premier Signal', duration: '48m', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', overview: 'Une cyber-attaque sans précédent paralyse le quartier de la Défense 2.0.' },
          { id: 'cg-s1e2', episodeNumber: 2, title: 'Épisode 2 - Mémoire Fantôme', duration: '52m', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', overview: 'L’inspectrice Vane découvre des fragments de code dans le cortex d’un haut fonctionnaire.' },
          { id: 'cg-s1e3', episodeNumber: 3, title: 'Épisode 3 - Le Réseau Obscur', duration: '45m', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', overview: 'Descente dans les bas-fonds de la ville souterraine.' }
        ]
      },
      {
        seasonNumber: 2,
        title: 'Saison 2 : La Rupture',
        episodes: [
          { id: 'cg-s2e1', episodeNumber: 1, title: 'Épisode 1 - Renaissance', duration: '50m', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', overview: 'De nouvelles alliances émergent après la chute du serveur central.' }
        ]
      }
    ]
  },
  {
    id: 'series-deep-abyss',
    title: 'Abysses : L’Expédition Stellaire',
    poster: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80',
    category: 'Aventure',
    rating: '12+',
    releaseYear: 2023,
    overview: 'L’équipage du sous-marin de recherche Nautilus III découvre une cité engloutie dotée d’une technologie extraterrestre intacte.',
    genre: ['Aventure', 'Mystère', 'Science'],
    totalSeasons: 1,
    seasons: [
      {
        seasonNumber: 1,
        title: 'Saison 1 : Les Portes des Profondeurs',
        episodes: [
          { id: 'da-s1e1', episodeNumber: 1, title: 'Épisode 1 - La Fosse des Mariannes', duration: '54m', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', overview: 'Descente record à plus de 11 000 mètres de profondeur.' },
          { id: 'da-s1e2', episodeNumber: 2, title: 'Épisode 2 - Le Sanctuaire', duration: '51m', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', overview: 'Premier contact avec une structure architecturale inconnue.' }
        ]
      }
    ]
  }
];
