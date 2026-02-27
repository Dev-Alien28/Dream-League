// src/utils/cardHelpers.js - Fonctions utilitaires partagées pour les cartes
const { RARITIES, CARD_TYPES, PSG_BLUE } = require('../config/settings');

function getRarityColor(rarity) {
  return RARITIES[rarity]?.color || PSG_BLUE;
}

function getRarityEmoji(rarity) {
  return RARITIES[rarity]?.emoji || '⚫';
}

function getCardTypeEmoji(cardType) {
  return CARD_TYPES[cardType]?.emoji || '🎴';
}

function getRarityCardImage(rarity) {
  const images = {
    Basic: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png',
    Advanced: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/1200px-Paris_Saint-Germain_Logo.svg.png',
    Elite: 'https://upload.wikimedia.org/wikipedia/fr/thumb/8/86/Paris_Saint-Germain_Logo.svg/2048px-Paris_Saint-Germain_Logo.svg.png',
    Unique: 'https://upload.wikimedia.org/wikipedia/commons/4/43/PSG_logo_logotype.png',
    Legend: 'https://upload.wikimedia.org/wikipedia/commons/4/43/PSG_logo_logotype.png',
  };
  return images[rarity] || images.Basic;
}

function createStatBar(value, maxValue = 100) {
  const filled = Math.floor((value / maxValue) * 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatCardStats(card) {
  const stats = card.stats || {};
  const cardType = card.type || 'joueur';

  if (cardType === 'joueur') {
    const position = card.position || 'Inconnu';

    // Clés avec accents pour correspondre aux JSON
    const statNames = {
      Attaquant: ['frappe', 'technique', 'contrôle'],
      Milieu:    ['technique', 'intelligence', 'contrôle'],
      Défenseur: ['intelligence', 'pression', 'physique'],
      Gardien:   ['physique', 'agilité', 'arrêt'],
    };

    // Labels d'affichage sans accents pour l'alignement monospace
    const statLabels = {
      'frappe':        'Frappe',
      'technique':     'Technique',
      'contrôle':      'Contrôle',
      'intelligence':  'Intelligence',
      'pression':      'Pression',
      'physique':      'Physique',
      'agilité':       'Agilité',
      'arrêt':         'Arrêt',
    };

    const names = statNames[position] || Object.keys(stats).slice(0, 3);
    const labels = names.map(n => statLabels[n] || (n.charAt(0).toUpperCase() + n.slice(1)));
    const maxLen = Math.max(...labels.map(l => l.length));
    const lines = [`**Position:** ${position}`];

    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      const label = labels[i];
      const value = stats[key] ?? 0;
      const bar = createStatBar(value);
      lines.push(`\`${label.padEnd(maxLen + 1)}\` ${bar} \`${String(value).padStart(2, ' ')}/100\``);
    }
    return lines.join('\n');

  } else {
    const lines = [];
    const entries = Object.entries(stats);
    if (!entries.length) return 'Aucune statistique';
    const maxLen = Math.max(...entries.map(([k]) => k.length));
    for (const [statName, statValue] of entries) {
      if (typeof statValue === 'number' && statValue <= 100) {
        const bar = createStatBar(statValue);
        const padded = statName.charAt(0).toUpperCase() + statName.slice(1);
        lines.push(`\`${padded.padEnd(maxLen + 1)}\` ${bar} \`${String(statValue).padStart(2, ' ')}/100\``);
      } else {
        lines.push(`**${statName.charAt(0).toUpperCase() + statName.slice(1)}:** ${statValue}`);
      }
    }
    return lines.join('\n') || 'Aucune statistique';
  }
}

function getCardImageUrl(card) {
  const img = card.image || '';
  if (img.startsWith('http://') || img.startsWith('https://')) {
    if (img.length <= 2048) return img;
  }
  return null;
}

function weightedRandom(dropRates) {
  const rarities = Object.keys(dropRates).filter(r => dropRates[r] > 0);
  const weights = rarities.map(r => dropRates[r]);
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < rarities.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return rarities[i];
  }
  return rarities[rarities.length - 1];
}

module.exports = {
  getRarityColor,
  getRarityEmoji,
  getCardTypeEmoji,
  getRarityCardImage,
  createStatBar,
  formatCardStats,
  getCardImageUrl,
  weightedRandom,
};