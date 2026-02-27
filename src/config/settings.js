// src/config/settings.js - Configuration principale du bot PSG
require('dotenv').config();
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  throw new Error('❌ ERREUR: Le token Discord n\'est pas défini dans le fichier .env');
}

// ✅ Chemins absolus — fonctionnent peu importe d'où Node.js est lancé
// __dirname = src/config/, on remonte 1 fois pour atteindre src/
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

// Couleurs PSG
const PSG_BLUE  = 0x001F5B;
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
    emoji: '🟠',
    color: 0xFF6B00,
    name: 'Legend',
  },
  Unique: {
    emoji: '⭐',
    color: 0xFFD700,
    name: 'Unique',
  },
};

// ============================================
// TYPES DE CARTES
// ============================================
const CARD_TYPES = {
  joueur: {
    emoji: '⚽',
    positions: {
      Gardien:   ['physique', 'agilite', 'arret'],
      Défenseur: ['intelligence', 'pression', 'physique'],
      Milieu:    ['technique', 'intelligence', 'controle'],
      Attaquant: ['frappe', 'technique', 'controle'],
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
    prix: 25,
    description: "Set de base composé des joueurs des saisons 24/25 et 25/26, obtenez des joueurs de la rareté 'Elite' surpuissants comme Hakimi, Dembélé ou Vitinha",
    fichier: 'psg_start.json',
    emoji: '🔴🔵',
    drop_rates: {
      Basic:    70,
      Advanced: 25,
      Elite:     5,
      Unique:    0,
    },
  },
  free_pack: {
    nom: 'Pack Journalier',
    prix: 0,
    description: "Pack gratuit repris du PSG Start disponible toutes les 24h, obtenez des joueurs jusqu'à la rareté 'Advanced'",
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
    description: 'Pack exclusif du mini-jeu',
    fichier: 'pack_event.json',
    emoji: '✨',
    drop_rates: {
      Elite:  60,
      Legend: 40,
    },
  },
};

// ============================================
// MINI-JEU
// ============================================
const MINIGAME_CONFIG = {
  min_interval_days: 4,
  max_interval_days: 7,
  start_hour: 7,
  end_hour: 24,
  timeout: 30,
  reward_pack: 'pack_event',
};

// ============================================
// EXEMPLE DE DONNÉES PACKS (pour initialisation)
// ============================================
const EXEMPLE_PACKS = {
  'psg_start.json': [
    { id: 'gk_donnarumma_basic',  type: 'joueur', nom: 'Gianluigi Donnarumma 24/25',    rareté: 'Basic',    position: 'Gardien',   stats: { physique: 83, agilite: 85, arret: 85 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'gk_chevalier_basic',   type: 'joueur', nom: 'Lucas Chevalier 25/26',          rareté: 'Basic',    position: 'Gardien',   stats: { physique: 76, agilite: 79, arret: 78 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'def_hakimi_basic',     type: 'joueur', nom: 'Achraf Hakimi 24/25 Home',       rareté: 'Basic',    position: 'Défenseur', stats: { intelligence: 83, pression: 83, physique: 85 },           image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'def_mendes_basic',     type: 'joueur', nom: 'Nuno Mendes 25/26 Home',         rareté: 'Basic',    position: 'Défenseur', stats: { intelligence: 83, pression: 85, physique: 83 },           image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'mid_vitinha_basic',    type: 'joueur', nom: 'Vitinha 25/26 Fourth',           rareté: 'Basic',    position: 'Milieu',    stats: { technique: 83, intelligence: 84, controle: 85 },          image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'att_dembele_basic',    type: 'joueur', nom: 'Ousmane Dembélé 25/26 Home',     rareté: 'Basic',    position: 'Attaquant', stats: { frappe: 83, technique: 86, controle: 85 },                image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'gk_donnarumma_adv',    type: 'joueur', nom: 'Gianluigi Donnarumma 24/25',    rareté: 'Advanced', position: 'Gardien',   stats: { physique: 86, agilite: 88, arret: 88 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/2048px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'gk_donnarumma_elite',  type: 'joueur', nom: 'Gianluigi Donnarumma 24/25',    rareté: 'Elite',    position: 'Gardien',   stats: { physique: 89, agilite: 91, arret: 91 },                  image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/2048px-Paris_Saint-Germain_Logo.svg.png' },
    { id: 'coll_enrique',         type: 'collectible', nom: 'Luis Enrique',              rareté: 'Unique',   stats: { prestige: 95, annee: 2024, rarete: 99 },                                        image: 'https://upload.wikimedia.org/wikipedia/commons/4/43/PSG_logo_logotype.png' },
    { id: 'coll_ucl',             type: 'collectible', nom: 'The Champions League 2024/2025', rareté: 'Unique', stats: { prestige: 100, annee: 2025, rarete: 100 },                                   image: 'https://upload.wikimedia.org/wikipedia/commons/4/43/PSG_logo_logotype.png' },
  ],
  'free_pack.json': [
    { id: 'gk_tenas_basic', type: 'joueur', nom: 'Arnau Tenas 24/25', rareté: 'Basic', position: 'Gardien', stats: { physique: 71, agilite: 75, arret: 72 }, image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png' },
  ],
  'pack_event.json': [
    { id: 'att_dembele_elite', type: 'joueur', nom: 'Ousmane Dembélé 25/26 Home', rareté: 'Elite', position: 'Attaquant', stats: { frappe: 89, technique: 92, controle: 91 }, image: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/2048px-Paris_Saint-Germain_Logo.svg.png' },
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
  EXEMPLE_PACKS,
  PSG_FOOTER_ICON,
};