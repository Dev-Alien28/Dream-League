// src/config/settings.js - Configuration principale du bot PSG
require('dotenv').config();
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  throw new Error('❌ ERREUR: Le token Discord n\'est pas défini dans le fichier .env');
}

// ✅ Chemins absolus — fonctionnent peu importe d'où Node.js est lancé
const ROOT_DIR   = path.resolve(__dirname, '..');
const DATA_DIR   = path.join(ROOT_DIR, 'data');
const PACKS_DIR  = path.join(DATA_DIR, 'packs');
const SERVERS_DIR = path.join(DATA_DIR, 'servers');
const ARGENT_FILE = path.join(DATA_DIR, 'argent.json');
const EVENT_FILE  = path.join(DATA_DIR, 'event_state.json');
const REMINDER_CONFIG_FILE = path.join(DATA_DIR, 'reminder_config.json');

// Paramètres
const COINS_PER_MESSAGE_INTERVAL = 1;
const COINS_ON_JOIN = 10;
const MIN_MESSAGE_LENGTH = 10;

// ==================== MATCH CONFIG (V3) ====================

const MATCH_CONFIG = {
  cooldown_minutes: 1,
};

// Couleurs PSG
const PSG_BLUE  = 0x57B9FF;
const PSG_RED   = 0xDA0037;
const PSG_GREEN = 0x00D25B;

// ============================================
// RARETÉS OFFICIELLES PSG
// ============================================
const RARITIES = {
  Basic: {
    emoji: '🟢',
    color: 0x00FF00,
    name: 'Basic',
  },
  Advanced: {
    emoji: '🔵',
    color: 0x0000FF,
    name: 'Advanced',
  },
  Elite: {
    emoji: '🟣',
    color: 0x9D00FF,
    name: 'Elite',
  },
  Legend: {
    emoji: '🟡',
    color: 0xFFDF00,
    name: 'Legend',
  },
  Unique: {
    emoji: '⭐',
    color: 0xFFD700,
    name: 'Unique',
  },
  Give: {
    emoji: '🎁',
    color: 0xFF0000,
    name: 'Give',
  },
  Encounter: {
    emoji: '👔',
    color: 0xFDF1B8,
    name: 'Encounter',
  },
};

// ============================================
// TYPES DE CARTES
// ============================================
const CARD_TYPES = {
  joueur: {
    emoji: '⚽',
    positions: {
      Gardien:   ['physique', 'agilité', 'arrêt'],
      Défenseur: ['intelligence', 'pression', 'physique'],
      Milieu:    ['technique', 'intelligence', 'contrôle'],
      Attaquant: ['frappe', 'technique', 'contrôle'],
    },
  },
  collectible: {
    emoji: '🎖️',
    stats: ['prestige', 'annee', 'rarete'],
  },
};

// ============================================
// CONFIGURATION DES PACKS
// ============================================
const PACKS_CONFIG = {
  psg_start: {
    nom: 'PSG Start',
    prix: 50,
    description: "Set de base composé des joueurs des saisons 24/25 et 25/26, obtenez des joueurs de la rareté 'Elite' surpuissants comme Hakimi, Dembélé ou Vitinha.",
    fichier: 'psg_start.json',
    emoji: '🔴🔵',
    drop_rates: {
      Basic:    70,
      Advanced: 25,
      Elite:     5,
      Unique:    0,
    },
  },
  psg_11_03: {
    nom: '11/03 is magic',
    prix: 100,
    description: 'Retrouvez tous les joueurs ayant vécu la célèbre date du 11/03, des joueurs marquant tels que Thiago Silva, Neymar Jr ou Kvaratskhelia.',
    fichier: 'pack_11_03.json',
    emoji: '🪄',
    drop_rates: {
      Basic:    70,
      Advanced: 25,
      Elite:     5,
      Unique:    0,
    },
  },
  Back_to_Back: {
    nom: 'Back to Back ⭐',
    prix: 2600,
    description: "Le PSG vient de soulever la Ligue des Champions ! Pour célébrer ce sacre historique, débloquez des cartes Elite surpuissantes des héros qui ont écrit cette légende : Kvaratskhelia, Dembélé, Marquinhos et bien d'autres.",
    fichier: 'back_to_back.json',
    emoji: '⭐',
    drop_rates: {
      Advanced: 60,
      Elite:     40,
    },
  },
  edf_psg: {
    nom: 'EDF X PSG',
    prix: 80,
    description: "Dans ce set, retrouvez tous les joueurs du PSG ayant déjà participé à une Coupe du Monde avec l'équipe de France. Avec notamment la toute première carte Legend du jeu : Kylian Mbappé ! Mais ce n'est pas tout, de nombreux autres joueurs emblématiques sont également à collectionner.",
    fichier: 'pack_edf_psg.json',
    emoji: '🐔',
    drop_rates: {
      Basic:    70,
      Advanced: 25,
      Elite:     4,
      Legend:    1,
    },
  },
  starter_pack: {
      nom: 'Pack Starter',
      prix: 0,
      hidden: true,          // ← ajouter cette ligne
      description: "Set de bienvenue ...",
      fichier: 'pack_starter.json',
      emoji: '🎖️',
      one_shot: true,
      drop_rates: {
        Basic: 100,
      },
    },
  free_pack: {
    nom: 'Pack Journalier',
    prix: 0,
    description: "Pack gratuit repris du PSG Start disponible toutes les 24h, obtenez des joueurs jusqu'à la rareté Advanced.",
    fichier: 'free_pack.json',
    emoji: '🎁',
    cooldown: 86400,
    drop_rates: {
      Basic:    85,
      Advanced: 15,
    },
  },
  pack_event: {
    nom: 'Pack Événement',
    prix: 0,
    description: 'Pack exclusif du mini-jeu (fallback si pack_encounter.json absent)',
    fichier: 'pack_event.json',
    emoji: '✨',
    drop_rates: {
      Elite:  60,
      Legend: 40,
    },
  },
};

// ============================================
// PSG ENCOUNTER — CONFIG COMPLÈTE (V2)
// ============================================
const MINIGAME_CONFIG = {
  timeout: 60,
  reward_pack: 'pack_encounter',
};

// Valeurs par défaut pour l'encounter dynamique (V2 — fourchette min/max)
const DEFAULT_ENCOUNTER_INTERVAL_MIN_MS = 86_400_000; // 1 jour
const DEFAULT_ENCOUNTER_INTERVAL_MAX_MS = 86_400_000; // 1 jour
const DEFAULT_ENCOUNTER_START_HOUR      = 8;
const DEFAULT_ENCOUNTER_END_HOUR        = 23;
const DEFAULT_ENCOUNTER_TIMEOUT_S       = 60;

// ============================================
// EXEMPLE DE DONNÉES PACKS (pour initialisation)
// ============================================
const EXEMPLE_PACKS = {
  'psg_start.json': [
    { id: 'gk_donnarumma_basic',  type: 'joueur', nom: 'Gianluigi Donnarumma 24/25',    rareté: 'Basic',    position: 'Gardien',   stats: { physique: 83, 'agilité': 85, 'arrêt': 85 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'gk_chevalier_basic',   type: 'joueur', nom: 'Lucas Chevalier 25/26',          rareté: 'Basic',    position: 'Gardien',   stats: { physique: 76, 'agilité': 79, 'arrêt': 78 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'def_hakimi_basic',     type: 'joueur', nom: 'Achraf Hakimi 24/25 Home',       rareté: 'Basic',    position: 'Défenseur', stats: { intelligence: 83, pression: 83, physique: 85 },               image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'att_dembele_basic',    type: 'joueur', nom: 'Ousmane Dembélé 25/26 Home',     rareté: 'Basic',    position: 'Attaquant', stats: { frappe: 83, technique: 86, 'contrôle': 85 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'gk_donnarumma_elite',  type: 'joueur', nom: 'Gianluigi Donnarumma 24/25',    rareté: 'Elite',    position: 'Gardien',   stats: { physique: 89, 'agilité': 91, 'arrêt': 91 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/2048px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'coll_ucl',             type: 'collectible', nom: 'The Champions League 2024/2025', rareté: 'Unique', stats: { prestige: 100, annee: 2025, rarete: 100 },                                       image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
  ],
  'free_pack.json': [
    { id: 'gk_tenas_basic', type: 'joueur', nom: 'Arnau Tenas 24/25', rareté: 'Basic', position: 'Gardien', stats: { physique: 71, 'agilité': 75, 'arrêt': 72 }, image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
  ],
  'pack_edf_psg.json': [
    { id: 'joueur_att_mbappe_edf_basic_200',    type: 'joueur', nom: 'Kylian Mbappé EDF',         rareté: 'Basic',    position: 'Attaquant', stats: { frappe: 87, technique: 86, 'contrôle': 85 }, image: 'images/cards/Carte_1.png' },
    { id: 'joueur_att_mbappe_edf_adv_210',      type: 'joueur', nom: 'Kylian Mbappé EDF',         rareté: 'Advanced', position: 'Attaquant', stats: { frappe: 90, technique: 89, 'contrôle': 88 }, image: 'images/cards/Carte_2.png' },
    { id: 'joueur_att_mbappe_edf_elite_220',    type: 'joueur', nom: 'Kylian Mbappé EDF',         rareté: 'Elite',    position: 'Attaquant', stats: { frappe: 93, technique: 92, 'contrôle': 91 }, image: 'images/cards/Carte_3.png' },
    { id: 'joueur_att_mbappe_edf_legend_230',   type: 'joueur', nom: 'Kylian Mbappé EDF',         rareté: 'Legend',   position: 'Attaquant', stats: { frappe: 96, technique: 95, 'contrôle': 94 }, image: 'images/cards/mbappe.png', artiste: '@.raizo._' },
    { id: 'joueur_mid_makelele_edf_basic_232',  type: 'joueur', nom: 'Claude Makélélé EDF',       rareté: 'Basic',    position: 'Milieu',    stats: { technique: 83, intelligence: 86, 'contrôle': 82 }, image: 'images/cards/Carte_1.png' },
    { id: 'joueur_gk_bats_edf_basic_261',       type: 'joueur', nom: 'Joël Bats EDF',             rareté: 'Basic',    position: 'Gardien',   stats: { physique: 80, 'agilité': 84, 'arrêt': 87 },    image: 'images/cards/Carte_1.png' },
    { id: 'joueur_def_sakho_edf_basic_279',     type: 'joueur', nom: 'Mamadou Sakho EDF',         rareté: 'Basic',    position: 'Défenseur', stats: { intelligence: 85, pression: 83, physique: 86 }, image: 'images/cards/Carte_1.png' },
  ],
  'pack_starter.json': [
    { id: 'joueur_gk_apoula_starter_001',        type: 'joueur', nom: 'Apoula Edel Starter',            rareté: 'Basic', position: 'Gardien',   stats: { physique: 75, 'agilité': 75, 'arrêt': 75 },        image: 'images/cards/Carte_1.png' },
    { id: 'joueur_gk_kokkinis_starter_002',      type: 'joueur', nom: 'Thomas Kokkinis Starter',        rareté: 'Basic', position: 'Gardien',   stats: { physique: 75, 'agilité': 75, 'arrêt': 75 },        image: 'images/cards/Carte_1.png' },
    { id: 'joueur_def_kurzawa_starter_003',      type: 'joueur', nom: 'Layvin Kurzawa Starter',         rareté: 'Basic', position: 'Défenseur', stats: { intelligence: 75, pression: 75, physique: 75 },     image: 'images/cards/Carte_1.png' },
    { id: 'joueur_def_coelho_starter_004',       type: 'joueur', nom: 'Humberto Coelho Starter',        rareté: 'Basic', position: 'Défenseur', stats: { intelligence: 75, pression: 75, physique: 75 },     image: 'images/cards/Carte_1.png' },
    { id: 'joueur_def_tanasi_starter_005',       type: 'joueur', nom: 'Franck Tanasi Starter',          rareté: 'Basic', position: 'Défenseur', stats: { intelligence: 75, pression: 75, physique: 75 },     image: 'images/cards/Carte_1.png' },
    { id: 'joueur_def_zajaczkowski_starter_006', type: 'joueur', nom: 'Christian Zajaczkowski Starter', rareté: 'Basic', position: 'Défenseur', stats: { intelligence: 75, pression: 75, physique: 75 },     image: 'images/cards/Carte_1.png' },
    { id: 'joueur_def_ngotty_starter_007',       type: 'joueur', nom: "Bruno N'Gotty Starter",          rareté: 'Basic', position: 'Défenseur', stats: { intelligence: 75, pression: 75, physique: 75 },     image: 'images/cards/Carte_1.png' },
    { id: 'joueur_mid_rsanches_starter_008',     type: 'joueur', nom: 'Renato Sanches Starter',         rareté: 'Basic', position: 'Milieu',    stats: { technique: 75, intelligence: 75, 'contrôle': 75 },  image: 'images/cards/Carte_1.png' },
    { id: 'joueur_mid_cisse_starter_009',        type: 'joueur', nom: 'Édouard Cissé Starter',          rareté: 'Basic', position: 'Milieu',    stats: { technique: 75, intelligence: 75, 'contrôle': 75 },  image: 'images/cards/Carte_1.png' },
    { id: 'joueur_mid_ugarte_starter_010',       type: 'joueur', nom: 'Manuel Ugarte Starter',          rareté: 'Basic', position: 'Milieu',    stats: { technique: 75, intelligence: 75, 'contrôle': 75 },  image: 'images/cards/Carte_1.png' },
    { id: 'joueur_mid_alcantara_starter_011',    type: 'joueur', nom: 'Rafael Alcántara Starter',       rareté: 'Basic', position: 'Milieu',    stats: { technique: 75, intelligence: 75, 'contrôle': 75 },  image: 'images/cards/Carte_1.png' },
    { id: 'joueur_att_vujovic_starter_012',      type: 'joueur', nom: 'Zlatko Vujović Starter',         rareté: 'Basic', position: 'Attaquant', stats: { frappe: 75, technique: 75, 'contrôle': 75 },        image: 'images/cards/Carte_1.png' },
    { id: 'joueur_att_loko_starter_013',         type: 'joueur', nom: 'Patrice Loko Starter',           rareté: 'Basic', position: 'Attaquant', stats: { frappe: 75, technique: 75, 'contrôle': 75 },        image: 'images/cards/Carte_1.png' },
    { id: 'joueur_att_ikone_starter_014',        type: 'joueur', nom: 'Jonathan Ikoné Starter',         rareté: 'Basic', position: 'Attaquant', stats: { frappe: 75, technique: 75, 'contrôle': 75 },        image: 'images/cards/Carte_1.png' },
    { id: 'joueur_att_hoarau_starter_015',       type: 'joueur', nom: 'Guillaume Hoarau Starter',       rareté: 'Basic', position: 'Attaquant', stats: { frappe: 75, technique: 75, 'contrôle': 75 },        image: 'images/cards/Carte_1.png' },
  ],
};

const PSG_FOOTER_ICON = 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/2048px-Paris_Saint-Germain_Logo.svg.png';

module.exports = {
  TOKEN,
  DATA_DIR,
  PACKS_DIR,
  SERVERS_DIR,
  ARGENT_FILE,
  EVENT_FILE,
  REMINDER_CONFIG_FILE,
  COINS_PER_MESSAGE_INTERVAL,
  COINS_ON_JOIN,
  MIN_MESSAGE_LENGTH,
  PSG_BLUE,
  PSG_RED,
  PSG_GREEN,
  RARITIES,
  CARD_TYPES,
  PACKS_CONFIG,
  MINIGAME_CONFIG,
  DEFAULT_ENCOUNTER_INTERVAL_MIN_MS,
  DEFAULT_ENCOUNTER_INTERVAL_MAX_MS,
  DEFAULT_ENCOUNTER_START_HOUR,
  DEFAULT_ENCOUNTER_END_HOUR,
  DEFAULT_ENCOUNTER_TIMEOUT_S,
  EXEMPLE_PACKS,
  PSG_FOOTER_ICON,
  MATCH_CONFIG,
};