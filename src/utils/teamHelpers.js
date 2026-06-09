// src/utils/teamHelpers.js - Helpers partagés pour le système Équipe & Match

// ==================== FORMATIONS ====================

const FORMATIONS = {
  '4-3-3': {
    label: '4-3-3',
    style: 'offensif',
    styleLabel: '⚡ Offensif — Ailes',
    description: 'Jeu rapide sur les côtés, forte pression haute',
    postes: {
      Gardien:   1,
      Défenseur: 4,
      Milieu:    3,
      Attaquant: 3,
    },
    flatBonus: { attaque: 5, defense: 0, milieu: 0 },
  },
  '4-4-2': {
    label: '4-4-2',
    style: 'equilibre',
    styleLabel: '⚖️ Équilibré',
    description: 'Bloc solide, transition rapide, deux pointes',
    postes: {
      Gardien:   1,
      Défenseur: 4,
      Milieu:    4,
      Attaquant: 2,
    },
    flatBonus: { attaque: 3, defense: 3, milieu: 3 },
  },
  '4-2-3-1': {
    label: '4-2-3-1',
    style: 'possession',
    styleLabel: '🎯 Possession',
    description: 'Double pivot, relance propre, milieu dominant',
    postes: {
      Gardien:   1,
      Défenseur: 4,
      Milieu:    5,
      Attaquant: 1,
    },
    flatBonus: { attaque: 0, defense: 3, milieu: 8 },
  },
  '5-3-2': {
    label: '5-3-2',
    style: 'defensif',
    styleLabel: '🛡️ Défensif — Contre',
    description: 'Bloc bas, contre-attaque rapide, solidité défensive',
    postes: {
      Gardien:   1,
      Défenseur: 5,
      Milieu:    3,
      Attaquant: 2,
    },
    flatBonus: { attaque: 0, defense: 8, milieu: 0 },
  },
  '3-5-2': {
    label: '3-5-2',
    style: 'milieu',
    styleLabel: '🔄 Domination milieu',
    description: 'Pressing intense, contrôle total du milieu',
    postes: {
      Gardien:   1,
      Défenseur: 3,
      Milieu:    5,
      Attaquant: 2,
    },
    flatBonus: { attaque: 0, defense: 0, milieu: 10 },
  },
  '4-5-1': {
    label: '4-5-1',
    style: 'pressing',
    styleLabel: '🔥 Pressing haut',
    description: 'Cinq milieux, pressing permanent, intensité maximale',
    postes: {
      Gardien:   1,
      Défenseur: 4,
      Milieu:    5,
      Attaquant: 1,
    },
    flatBonus: { attaque: 0, defense: 3, milieu: 8 },
  },
};

// ==================== RARETÉS ====================

// RARITY_WEIGHTS conservé pour rétrocompatibilité mais n'est plus utilisé
// dans les calculs de force — tout repose désormais sur les stats brutes.
const RARITY_WEIGHTS = {
  Basic:      1.0,
  Advanced:   1.0,
  Elite:      1.0,
  Unique:     1.0,
  Legend:     1.0,
  Encounter:  1.0,
  Give:       1.0,
  Épique:     1.0,
  Légendaire: 1.0,
};

const RARITY_EMOJIS = {
  Basic:      '🟢',
  Advanced:   '🔵',
  Elite:      '🟣',
  Unique:     '⭐',
  Legend:     '🟠',
  Encounter:  '👔',
  Give:       '🎁',
  Épique:     '💥',
  Légendaire: '🌟',
};

// ==================== FORCE D'UNE CARTE ====================

/**
 * Force d'une carte = somme de ses 3 stats brutes (max 300).
 * Utilisée à la fois pour le tri dans les menus ET pour le calcul des forces d'équipe.
 * La rareté n'intervient pas : seules les stats comptent.
 * Ex : frappe 90 + technique 89 + contrôle 88 = 267
 */
function getCardStrength(card) {
  const stats  = card.stats || {};
  const values = Object.values(stats).filter(v => typeof v === 'number' && v <= 100);
  if (!values.length) return 150;
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Alias de getCardStrength — conservé pour la compatibilité avec les appels existants.
 */
function getRawCardStrength(card) {
  return getCardStrength(card);
}

// ==================== FORCE D'ÉQUIPE PAR SECTEUR ====================

/**
 * Calcule les forces d'une équipe par secteur, sur une échelle de 0 à 300.
 *
 * Règles :
 * - Chaque secteur ne compte QUE ses propres joueurs.
 *   → Force attaque  = moyenne des sommes de stats des Attaquants uniquement.
 *   → Force défense  = moyenne des sommes de stats des Défenseurs + Gardien.
 *   → Force milieu   = moyenne des sommes de stats des Milieux uniquement.
 * - La rareté n'intervient pas.
 * - La formation applique un bonus PLAT (points fixes) selon sa spécialité.
 * - Le résultat est plafonné à 300 (3 stats × 100).
 *
 * @param {object} team      - { titulaires: Card[], formation: string }
 * @param {string} formation - clé de formation (ex: '4-3-3')
 * @returns {{ attack: number, defense: number, midfield: number, overall: number }}
 */
function getTeamStrength(team, formation) {
  const formationData = FORMATIONS[formation];
  if (!formationData) return { attack: 150, defense: 150, midfield: 150, overall: 150 };

  const sectors = { Attaquant: [], Milieu: [], Défenseur: [], Gardien: [] };

  for (const card of (team.titulaires || [])) {
    const pos = card.position || 'Milieu';
    if (sectors[pos] !== undefined) {
      sectors[pos].push(getCardStrength(card));
    } else {
      sectors['Milieu'].push(getCardStrength(card));
    }
  }

  const avg = arr => arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : 150;

  const rawAttack   = avg(sectors['Attaquant']);
  const rawDefense  = avg([...sectors['Défenseur'], ...sectors['Gardien']]);
  const rawMidfield = avg(sectors['Milieu']);

  const bonus = formationData.flatBonus || { attaque: 0, defense: 0, milieu: 0 };

  const attack   = Math.min(300, Math.round(rawAttack   + (bonus.attaque ?? 0)));
  const defense  = Math.min(300, Math.round(rawDefense  + (bonus.defense ?? 0)));
  const midfield = Math.min(300, Math.round(rawMidfield + (bonus.milieu  ?? 0)));
  const overall  = Math.round((attack + defense + midfield) / 3);

  return { attack, defense, midfield, overall };
}

// ==================== VÉRIFICATION D'ÉQUIPE ====================

/**
 * Vérifie si une liste de cartes correspond à une formation donnée.
 * Règles supplémentaires :
 *  - Les 5 remplaçants sont OBLIGATOIRES (équipe de 16).
 *  - Maximum 1 carte Legend dans toute l'équipe (titulaires + remplaçants).
 * Retourne { valid, errors }
 *
 * @param {Card[]} cards        - Les 11 titulaires
 * @param {string} formationKey - Clé de formation (ex: '4-3-3')
 * @param {Card[]} remplacants  - Les remplaçants (doit être exactement 5)
 */
function validateTeamComposition(cards, formationKey, remplacants = []) {
  const formation = FORMATIONS[formationKey];
  if (!formation) return { valid: false, errors: ['Formation inconnue.'] };

  const errors = [];
  const counts = { Gardien: 0, Défenseur: 0, Milieu: 0, Attaquant: 0 };

  for (const card of cards) {
    const pos = card.position;
    if (counts[pos] !== undefined) counts[pos]++;
    else errors.push(`Position inconnue : ${pos} (${card.nom})`);
  }

  for (const [pos, required] of Object.entries(formation.postes)) {
    if (counts[pos] !== required) {
      errors.push(`${pos} : ${counts[pos]}/${required} attendu`);
    }
  }

  // Les 5 remplaçants sont obligatoires
  if (remplacants.length !== 5) {
    errors.push(`Remplaçants : ${remplacants.length}/5 — les 5 remplaçants sont obligatoires.`);
  }

  // Maximum 1 carte Legend dans toute l'équipe (titulaires + remplaçants)
  const allCards    = [...cards, ...remplacants];
  const legendCount = allCards.filter(c => c.rareté === 'Legend').length;
  if (legendCount > 1) {
    errors.push(`Tu ne peux aligner qu'**une seule carte Legend** par équipe (${legendCount} détectées).`);
  }

  // Pas de doublon sur l'ensemble des 16 cartes
  const ids  = allCards.map(c => c.id);
  const uniq = new Set(ids);
  if (uniq.size !== ids.length) errors.push('Impossible d\'utiliser deux fois la même carte.');

  return { valid: errors.length === 0, errors };
}

/**
 * Nombre de titulaires requis par une formation.
 */
function getTitulairesCount(formationKey) {
  const f = FORMATIONS[formationKey];
  if (!f) return 11;
  return Object.values(f.postes).reduce((a, b) => a + b, 0);
}

/**
 * Retourne la liste des postes à remplir (dans l'ordre) pour une formation.
 * Ex: ['Gardien', 'Défenseur', 'Défenseur', ..., 'Attaquant']
 */
function getPostesOrder(formationKey) {
  const f = FORMATIONS[formationKey];
  if (!f) return [];
  const order  = ['Gardien', 'Défenseur', 'Milieu', 'Attaquant'];
  const result = [];
  for (const pos of order) {
    const count = f.postes[pos] || 0;
    for (let i = 0; i < count; i++) result.push(pos);
  }
  return result;
}

// ==================== FILTRES COLLECTION ====================

const PAGE_SIZE = 23;

/**
 * Retourne les cartes d'une collection filtrées par position, sans doublons d'ID,
 * triées par force décroissante (somme des stats brutes).
 */
function getAvailableCards(collection, position, excludeIds = [], page = 0) {
  const seen = new Set();

  const all = collection
    .filter(c => c.type === 'joueur' && c.position === position && !excludeIds.includes(c.id))
    .filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

  all.sort((a, b) => getCardStrength(b) - getCardStrength(a));

  const total      = all.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage   = Math.min(Math.max(0, page), totalPages - 1);
  const cards      = all.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return { cards, totalPages, total, page: safePage };
}

/**
 * Idem pour les remplaçants : tous postes confondus, triés par force brute.
 */
function getAvailableSubCards(collection, excludeIds = [], page = 0) {
  const seen = new Set();

  const all = collection
    .filter(c => c.type === 'joueur' && !excludeIds.includes(c.id))
    .filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

  all.sort((a, b) => getCardStrength(b) - getCardStrength(a));

  const total      = all.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage   = Math.min(Math.max(0, page), totalPages - 1);
  const cards      = all.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return { cards, totalPages, total, page: safePage };
}

// ==================== FORMATAGE ====================

function formatFormationEmoji(formationKey) {
  const f = FORMATIONS[formationKey];
  return f ? `${f.label} — ${f.styleLabel}` : formationKey;
}

function getRarityEmoji(rarity) {
  return RARITY_EMOJIS[rarity] ?? '⚫';
}

/**
 * Formate la force d'une carte en barre visuelle.
 * Ex: ████████ 276
 * Calibrée sur 300 (max brut = 3 stats × 100).
 */
function formatStrengthBar(card) {
  const strength = getCardStrength(card);
  const score    = Math.round(strength);
  const filled   = Math.round((strength / 300) * 8);
  const bar      = '█'.repeat(Math.min(8, filled)) + '░'.repeat(Math.max(0, 8 - filled));
  return `${bar} ${score}`;
}

module.exports = {
  FORMATIONS,
  RARITY_WEIGHTS,
  RARITY_EMOJIS,
  PAGE_SIZE,
  getCardStrength,
  getRawCardStrength,
  getTeamStrength,
  validateTeamComposition,
  getTitulairesCount,
  getPostesOrder,
  getAvailableCards,
  getAvailableSubCards,
  formatFormationEmoji,
  getRarityEmoji,
  formatStrengthBar,
};