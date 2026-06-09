// src/utils/matchEngine.js - Moteur de simulation de match v3.9
// COMPATIBILITÉ : match.js v3.9
//
// CHANGEMENTS v3.9 :
//   - IDs JOUEURS : utilise toujours card.id en priorité pour la clé stamina.
//     Si deux joueurs ont le même nom mais des IDs différents, chacun possède
//     sa propre entrée stamina. Les actions générées embarquent désormais
//     joueurId (id du joueur) EN PLUS de joueurNom.
//   - JOUEURS HORS-JEU : les joueurs expulsés (suspendedA/B), blessés
//     (injuredA/B) et remplacés (substitutedA/B) sont exclus des pools de
//     sélection pour les buts, tirs, presses, etc.
//     Chaque action porte un champ activeRosterA / activeRosterB contenant
//     les joueurs réellement sur le terrain à cet instant, pour que
//     commentaryEngine.js puisse filtrer correctement.
//   - SCORE PENALTY : les actions de type 'penalty' ne portent PLUS isBut=true.
//     Seul runPenaltyDuel dans match.js est responsable de l'incrément de
//     score. Les rawActions 'but' produites par simulateHalf excluent toujours
//     les minutes penalty (set transmis).
//   - GAPS COMMENTAIRES : MAX_MINUTE_GAP réduit à 4 et generateMinutesForHalf
//     renforcé pour garantir une action toutes les 4 minutes max.

const { getTeamStrength, FORMATIONS } = require('./teamHelpers');

// ==================== CONFIG ====================

const MATCH_DURATION = 90;
const HALFTIME       = 45;
const MAX_MINUTE_GAP = 4; // FIX v3.9 : réduit de 8 à 4 pour éviter les sauts

const GOAL_PROB_BASE_HT1 = 0.15;
const GOAL_PROB_BASE_HT2 = 0.18;

const YELLOW_CARD_PROB = 0.05;
const RED_CARD_PROB    = 0.006;
const INJURY_PROB      = 0.010;
const PENALTY_PROB     = 0.008;

const ADDED_TIME_HT1 = () => 2 + Math.floor(Math.random() * 3);
const ADDED_TIME_HT2 = () => 3 + Math.floor(Math.random() * 4);

const NAME_EXCLUDED_WORDS = new Set([
  'Home','Away','Third','Fourth',
  'Civil','Invictus','Héros','Hero','Legend','Légende',
  'Icon','Icône','Prime','Future','Flashback','Storyline',
  'Record','Breaker','Showdown','Headliner','Totw','Toty',
  'Community','Shapeshifter','Rulebreaker','Vintage',
  'EDF','Era','Edt','Sbc','Obj','Fut','Wc','Ucl','Uel','Uecl','Starter','Tuchel',
]);

const SUFFIX_NOISE = /^(Jr\.?|Sr\.?|II|III|IV|Era|Edt|Tuchel)$/i;

// ==================== COULEURS EMBED PAR ÉQUIPE ====================

const EMBED_COLOR_TEAM_A  = 0xCC0000;
const EMBED_COLOR_TEAM_B  = 0x4FC3F7;
const EMBED_COLOR_DEFAULT = 0x57F287;

function getEmbedColor(teamId, teamIdA) {
  if (!teamId || !teamIdA) return EMBED_COLOR_DEFAULT;
  return teamId === teamIdA ? EMBED_COLOR_TEAM_A : EMBED_COLOR_TEAM_B;
}

// ==================== STAMINA ====================

const STAMINA_DECAY_PER_MIN = {
  Attaquant: 0.28,
  Milieu:    0.22,
  Défenseur: 0.16,
  Gardien:   0.04,
};

const STAMINA_EVENT_COST = {
  Attaquant: { but: 4, tir: 2, passe: 1, defense: 2, default: 1 },
  Milieu:    { but: 3, tir: 2, passe: 1, defense: 2, default: 1 },
  Défenseur: { but: 2, tir: 1, passe: 1, defense: 3, default: 1 },
  Gardien:   { but: 0, tir: 0, passe: 0, defense: 1, default: 0 },
};

const STAMINA_CONCEDE_GOAL = {
  Attaquant: 1,
  Milieu:    1,
  Défenseur: 3,
  Gardien:   2,
};

const STAMINA_FLOOR = {
  Gardien:   65,
  Défenseur: 40,
  Milieu:    30,
  Attaquant: 30,
};

// FIX v3.9 : clé stamina = card.id si présent, sinon card.nom
function staminaKey(card) {
  return card.id != null ? String(card.id) : card.nom;
}

function initStamina(team) {
  const stamina = {};
  const all = [...(team.titulaires || []), ...(team.remplacants || [])];
  for (const card of all) {
    stamina[staminaKey(card)] = 100;
  }
  return stamina;
}

function getPosteNormalized(card) {
  const p = (card.position || card.poste || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (p.includes('gard'))                                                                  return 'Gardien';
  if (p.includes('def') || p.includes('lat') || p.includes('stop') || p.includes('lib')) return 'Défenseur';
  if (p.includes('att') || p.includes('avant') || p.includes('bu'))                      return 'Attaquant';
  return 'Milieu';
}

function getStaminaFloor(poste) {
  return STAMINA_FLOOR[poste] ?? 30;
}

function updateStamina(stamina, team, minutesPassed, goalsConceded = 0) {
  const updated    = { ...stamina };
  const titulaires = team.titulaires || [];

  for (const card of titulaires) {
    const key          = staminaKey(card);
    const poste        = getPosteNormalized(card);
    const decay        = STAMINA_DECAY_PER_MIN[poste] ?? 0.22;
    const concedeMalus = goalsConceded * (STAMINA_CONCEDE_GOAL[poste] ?? 1);
    const floor        = getStaminaFloor(poste);
    updated[key]       = Math.max(floor, (updated[key] ?? 100) - decay * minutesPassed - concedeMalus);
  }

  const nonGk = titulaires
    .filter(c => getPosteNormalized(c) !== 'Gardien')
    .sort((a, b) => (updated[staminaKey(a)] ?? 100) - (updated[staminaKey(b)] ?? 100));

  if (nonGk.length > 4) {
    for (let i = 4; i < nonGk.length; i++) {
      const key = staminaKey(nonGk[i]);
      if ((updated[key] ?? 100) < 55) {
        updated[key] = 55 + Math.floor(Math.random() * 8);
      }
    }
  }

  return updated;
}

function applyEventStamina(stamina, card, eventType) {
  const key = staminaKey(card);
  if (!(key in stamina)) return;
  const poste = getPosteNormalized(card);
  const costs = STAMINA_EVENT_COST[poste] ?? STAMINA_EVENT_COST['Milieu'];
  const floor = getStaminaFloor(poste);

  const t    = (eventType || '').toLowerCase();
  let cost   = costs.default;
  if (t.includes('but'))                               cost = costs.but;
  else if (t.includes('tir'))                          cost = costs.tir;
  else if (t.includes('pass') || t.includes('passe'))  cost = costs.passe;
  else if (t.includes('def') || t.includes('press'))   cost = costs.defense;

  cost += Math.floor(Math.random() * 3) - 1;
  stamina[key] = Math.max(floor, (stamina[key] ?? 100) - Math.max(0, cost));
}

function staminaFactor(team, stamina) {
  const tits = team.titulaires || [];
  if (!tits.length) return 1;
  const avg = tits.reduce((s, c) => s + (stamina[staminaKey(c)] ?? 100), 0) / tits.length;
  return 0.70 + (avg / 100) * 0.30;
}

function defenseStaminaFactor(team, stamina) {
  const defs = (team.titulaires || []).filter(c =>
    ['Défenseur', 'Gardien'].includes(getPosteNormalized(c))
  );
  if (!defs.length) return 1;
  const avg = defs.reduce((s, c) => s + (stamina[staminaKey(c)] ?? 100), 0) / defs.length;
  return 0.65 + (avg / 100) * 0.35;
}

// ==================== NOMS ====================

function cleanName(nom) {
  if (!nom) return nom;
  const parts = nom
    .split(' ')
    .map(p => p.replace(/^\(+|\)+$/g, ''))
    .filter(p =>
      p !== '' &&
      !/^\d{2}\/\d{2}$/.test(p) &&
      !NAME_EXCLUDED_WORDS.has(p) &&
      !SUFFIX_NOISE.test(p)
    );
  if (!parts.length) return nom.split(' ').pop() || nom;
  return parts.join(' ');
}

const shortName = cleanName;

function randomFrom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==================== MEILLEUR TIREUR DE PENALTY ====================

function getBestPenaltyTaker(team) {
  const pool = (team.titulaires || []).filter(c =>
    ['Attaquant', 'Milieu'].includes(getPosteNormalized(c))
  );
  if (!pool.length) return randomFrom(team.titulaires || []);

  return pool.reduce((best, c) => {
    const score  = c.overall ?? c.note ?? c.rating ?? 0;
    const bScore = best.overall ?? best.note ?? best.rating ?? 0;
    return score > bScore ? c : best;
  }, pool[0]);
}

// ==================== COMMENTAIRES ====================

const COMMENT_TEMPLATES = {
  but: [
    '⚽ **{att}** reçoit un centre parfait et expédie le ballon au fond des filets ! **BUT !**',
    '🔥 **{att}** élimine deux défenseurs et frappe en lucarne ! **BUT !**',
    '💥 **{att}** reprend de la tête un corner et trompe **{gk}** ! **BUT !**',
    '⚡ Contre-attaque éclair ! **{att}** se retrouve seul face à **{gk}** et ne tremble pas ! **BUT !**',
    '🎯 **{att}** décale, frappe du gauche, imparable pour **{gk}** ! **BUT !**',
    '✨ Une-deux entre **{mid}** et **{att}**, qui conclut froidement ! **BUT !**',
    '🚀 **{att}** reprend une passe de **{mid}** et fusille **{gk}** ! **BUT !**',
  ],
  penalty_but: [
    '⚽ **{att}** transforme le penalty avec sang-froid ! **BUT !**',
    '🎯 Penalty parfait de **{att}** — **{gk}** ne peut rien faire ! **BUT !**',
    '💥 **{att}** expédie le penalty dans le filet ! **BUT !**',
    '✅ Penalty imparable de **{att}** ! **BUT !**',
  ],
  penalty_arret: [
    '🧤 **{gk}** arrête le penalty de **{att}** ! Incroyable parade !',
    '🧤 **{gk}** plonge du bon côté et repousse le penalty de **{att}** !',
    '🧤 Arrêt héroïque de **{gk}** sur le penalty de **{att}** !',
  ],
  penalty_annonce: [
    '🚨 **PENALTY !** L\'arbitre désigne le point de penalty ! Faute dans la surface !',
    '🚨 **PENALTY !** L\'arbitre siffle une faute dans la surface ! Tension maximale !',
    '🚨 **PENALTY !** Le point de penalty est désigné ! Moment crucial !',
  ],
  carton_jaune: [
    '🟨 Carton jaune pour **{def}** ! L\'arbitre sort l\'avertissement !',
    '🟨 **{def}** reçoit un carton jaune ! Faute inutile sifflée !',
    '🟨 Avertissement pour **{def}** après cette faute grossière !',
  ],
  carton_rouge_direct: [
    '🟥 **CARTON ROUGE** pour **{def}** ! Expulsion directe ! Son équipe se retrouve à dix !',
    '🟥 **{def}** est exclu ! Geste dangereux sanctionné par un carton rouge direct !',
  ],
  carton_rouge_2jaunes: [
    '🟨🟥 Deuxième jaune pour **{def}** — **CARTON ROUGE** ! Il quitte le terrain !',
    '🟨🟥 **{def}** avait déjà un jaune — deuxième avertissement synonyme d\'expulsion !',
  ],
  blessure: [
    '🚑 **{def}** est à terre après un duel ! Le staff médical entre sur la pelouse !',
    '🚑 Blessure pour **{def}** ! Il ne peut pas continuer, remplacement forcé à venir !',
    '🚑 **{def}** doit quitter le terrain sur blessure ! Coup dur pour son équipe !',
  ],
  arret: [
    '🧤 **{gk}** sort une parade monumentale devant **{att}** ! Incroyable !',
    '🧤 **{gk}** détourne la frappe de **{att}** sur sa barre ! Quel réflexe !',
    '🧤 **{gk}** plonge et capte le tir de **{att}** ! Solide dans les buts.',
  ],
  tir_cadre: [
    '🎯 **{att}** déclenche une frappe puissante, repoussée par **{gk}** !',
    '🏹 Frappe lointaine de **{att}**, **{gk}** vigilant capte proprement !',
    '💫 **{att}** tente sa chance après un bon travail de **{mid}**, **{gk}** s\'interpose !',
  ],
  tir_hors: [
    '😬 **{att}** ouvre trop son pied, le ballon passe à côté !',
    '📐 La frappe de **{att}** s\'envole au-dessus de la barre !',
    '😤 **{att}** tente de loin, **{gk}** n\'a pas eu à s\'employer !',
  ],
  passe: [
    '🎨 **{mid}** trouve **{att}** dans la surface mais **{def}** intervient !',
    '🔄 **{mid}** sert **{att}** en profondeur, **{def}** repousse le danger !',
    '👌 Combinaison rapide entre **{mid}** et **{att}**, mais **{def}** coupe le ballon !',
  ],
  pressing: [
    '🦈 **{def}** intercepte la passe destinée à **{att}** et relance proprement !',
    '💪 **{def}** remporte son duel face à **{att}** et dégage le danger !',
    '🛡️ Intervention décisive de **{def}** juste avant que **{att}** n\'allait frapper !',
  ],
  hors_jeu: [
    '🚩 **{att}** était en position de hors-jeu, le drapeau se lève.',
    '⛳ Hors-jeu de **{att}** ! Le but est refusé.',
  ],
  temps_additionnel: [
    '⏱️ L\'arbitre indique **{t} minutes** de temps additionnel ! Tout est encore possible !',
    '⏱️ **{t} minutes** de temps additionnel annoncées ! La tension monte d\'un cran !',
    '⏱️ **{t} minutes** supplémentaires à jouer ! Les deux équipes restent concentrées !',
  ],
  debut_match: ['🎙️ Le coup d\'envoi est donné ! Les deux équipes entrent en jeu !'],
  debut_mt2:   ['🎙️ La seconde mi-temps reprend ! Les équipes sont de retour sur le terrain !'],
  fin_match:   ['🏁 Coup de sifflet final ! Le match est terminé !'],
  mi_temps:    ['⏸️ L\'arbitre siffle la mi-temps ! Les joueurs regagnent les vestiaires.'],
};

function pickComment(type) {
  const templates = COMMENT_TEMPLATES[type] || ['…'];
  return templates[Math.floor(Math.random() * templates.length)];
}

function fillComment(template, vars) {
  return template
    .replace(/{att}/g, vars.att || 'un attaquant')
    .replace(/{def}/g, vars.def || 'un défenseur')
    .replace(/{gk}/g,  vars.gk  || 'le gardien')
    .replace(/{mid}/g, vars.mid || 'un milieu')
    .replace(/{t}/g,   vars.t   || '?');
}

// ==================== GÉNÉRATION DES MINUTES ====================
// FIX v3.9 : garantit une action toutes les MAX_MINUTE_GAP minutes

function generateMinutesForHalf(nbActions, offset, duration, addedTime) {
  const set = new Set();

  if (addedTime > 0) {
    set.add(offset + duration);
  }

  // Semer les actions demandées
  let attempts = 0;
  while (set.size < nbActions + (addedTime > 0 ? 1 : 0) && attempts < 1000) {
    attempts++;
    const m = offset + 1 + Math.floor(Math.random() * (duration + addedTime - 2));
    set.add(m);
  }

  // Remplissage des gaps > MAX_MINUTE_GAP
  let sorted = [...set].sort((a, b) => a - b);
  const toAdd = new Set();

  // Gap entre offset et première action
  if (sorted.length === 0 || sorted[0] - offset > MAX_MINUTE_GAP) {
    const start = offset + 1;
    const end   = Math.min((sorted[0] ?? offset + MAX_MINUTE_GAP) - 1, offset + MAX_MINUTE_GAP - 1);
    if (end >= start) toAdd.add(start + Math.floor(Math.random() * (end - start + 1)));
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    let cursor = sorted[i];
    const next = sorted[i + 1];
    while (next - cursor > MAX_MINUTE_GAP) {
      const fill    = cursor + 1 + Math.floor(Math.random() * Math.min(MAX_MINUTE_GAP - 1, next - cursor - 1));
      const clamped = Math.min(fill, next - 1);
      if (clamped > cursor && !set.has(clamped)) {
        toAdd.add(clamped);
        cursor = clamped;
      } else {
        cursor++;
      }
    }
  }

  // Gap entre dernière action et fin de mi-temps
  const endMinute = offset + duration + addedTime;
  const last = sorted[sorted.length - 1] ?? (offset);
  if (endMinute - last > MAX_MINUTE_GAP) {
    const fill = last + 1 + Math.floor(Math.random() * Math.min(MAX_MINUTE_GAP - 1, endMinute - last - 1));
    if (fill > last && fill <= endMinute) toAdd.add(fill);
  }

  for (const m of toAdd) set.add(m);

  return [...set].sort((a, b) => a - b);
}

// ==================== SIMULATION D'UNE MI-TEMPS ====================
//
// FIX v3.9 :
//   - injuredA/B : Set des noms de joueurs blessés (ne peuvent plus être sélectionnés)
//   - substitutedA/B : Set des noms de joueurs remplacés
//   - activeRoster embarqué dans chaque action pour commentaryEngine
//   - Les actions 'but' à des minutes penalty sont skipées (penaltyMinutesSet)
//   - joueurId embarqué dans chaque action (id du joueur concerné)

function simulateHalf(
  teamA, teamB, strA, strB,
  staminaA, staminaB,
  scoreA, scoreB,
  yellowCards, suspendedA, suspendedB,
  halfIndex,
  redCardsA = 0,
  redCardsB = 0,
  injuredA = null,   // FIX v3.9 : Set des noms blessés équipe A
  injuredB = null,   // FIX v3.9 : Set des noms blessés équipe B
) {
  injuredA = injuredA || new Set();
  injuredB = injuredB || new Set();

  const actions  = [];
  const buteursA = [];
  const buteursB = [];

  // FIX v3.9 : tracker les minutes où un penalty est généré
  const penaltyMinutesGenerated = new Set();

  const addedTime = halfIndex === 1 ? ADDED_TIME_HT1() : ADDED_TIME_HT2();
  const offset    = halfIndex === 1 ? 1 : 46;
  const duration  = 45;
  const goalBase  = halfIndex === 1 ? GOAL_PROB_BASE_HT1 : GOAL_PROB_BASE_HT2;

  const nbActions = 6 + Math.floor(Math.random() * 6);
  const minutes   = generateMinutesForHalf(nbActions, offset, duration, addedTime);

  const teamIdA = teamA.userId;

  // FIX v3.9 : helper qui construit le roster actif (hors suspended/injured)
  function getActiveRoster(team, suspended, injured) {
    return (team.titulaires || []).filter(c =>
      !suspended[c.nom] && !injured.has(c.nom)
    );
  }

  for (const minute of minutes) {
    const isAddedTime = minute === offset + duration;

    if (isAddedTime && addedTime > 0) {
      actions.push({
        minute,
        text: fillComment(pickComment('temps_additionnel'), { t: addedTime }),
        type: 'info',
        isAddedTimeAnnounce: true,
        addedTime,
        scoreA,
        scoreB,
      });
      continue;
    }

    // FIX v3.9 : rosters actifs au moment de cette minute
    const activeTitA = getActiveRoster(teamA, suspendedA, injuredA);
    const activeTitB = getActiveRoster(teamB, suspendedB, injuredB);

    const dynSfA  = staminaFactor({ titulaires: activeTitA }, staminaA);
    const dynSfB  = staminaFactor({ titulaires: activeTitB }, staminaB);
    const dynDefA = defenseStaminaFactor({ titulaires: activeTitA }, staminaA);
    const dynDefB = defenseStaminaFactor({ titulaires: activeTitB }, staminaB);

    const effStrA = strA.overall * dynSfA * (activeTitA.length / 11);
    const effStrB = strB.overall * dynSfB * (activeTitB.length / 11);
    const diff    = effStrA - effStrB;
    const sumOv   = effStrA + effStrB || 100;
    const baseAdvA = 0.50 + (diff / sumOv) * 0.72;
    const advA     = Math.max(0.38, Math.min(0.72, baseAdvA));

    const noise    = (Math.random() * 0.10) - 0.05;
    const aAttacks = Math.random() < advA + noise;
    const attTeam  = aAttacks ? teamA : teamB;
    const defTeam  = aAttacks ? teamB : teamA;

    // FIX v3.9 : uniquement les joueurs actifs pour chaque équipe
    const attActive = aAttacks ? activeTitA : activeTitB;
    const defActive = aAttacks ? activeTitB : activeTitA;

    const dynDefFactor = aAttacks ? dynDefB : dynDefA;
    const dynAtkFactor = aAttacks ? dynSfA  : dynSfB;

    const attNames = [
      ...attActive.filter(c => c.position === 'Attaquant' || c.poste === 'Attaquant').map(c => ({ nom: cleanName(c.nom), id: staminaKey(c) })),
      ...attActive.filter(c => c.position === 'Milieu'    || c.poste === 'Milieu').map(c => ({ nom: cleanName(c.nom), id: staminaKey(c) })),
    ];
    const defNames = defActive
      .filter(c => c.position === 'Défenseur' || c.poste === 'Défenseur')
      .map(c => ({ nom: cleanName(c.nom), id: staminaKey(c) }));
    const gkCards  = defActive.filter(c => c.position === 'Gardien' || c.poste === 'Gardien');
    const midNames = attActive
      .filter(c => c.position === 'Milieu' || c.poste === 'Milieu')
      .map(c => ({ nom: cleanName(c.nom), id: staminaKey(c) }));

    const attPick = randomFrom(attNames);
    const defPick = randomFrom(defNames);
    const gkCard  = randomFrom(gkCards);
    const midPick = randomFrom(midNames);

    const vars = {
      att: attPick?.nom || 'un attaquant',
      def: defPick?.nom || 'un défenseur',
      gk:  gkCard ? cleanName(gkCard.nom) : 'le gardien',
      mid: midPick?.nom || 'un milieu',
    };

    const strAtt = aAttacks ? strA.attack  : strB.attack;
    const strDef = aAttacks ? strB.defense : strA.defense;

    const relBonus = Math.max(-0.05, Math.min(0.07, (strAtt - strDef) / 200));
    const fatBonus = (1 - dynDefFactor) * 0.12;
    const atkBonus = (dynAtkFactor - 0.85) * 0.05;
    let goalProb   = goalBase + relBonus + fatBonus + atkBonus;
    goalProb       = Math.max(0.08, Math.min(0.32, goalProb));

    const rand = Math.random();
    let text, type;
    let isBut     = false;
    let isPenalty = false;
    let isYellow  = false;
    let isRed     = false;
    let isInjury  = false;

    if (rand < PENALTY_PROB) {
      isPenalty = true;
      type      = 'penalty';
      text      = pickComment('penalty_annonce');
    } else if (rand < goalProb + PENALTY_PROB) {
      isBut = true;
      type  = 'but';
      text  = pickComment('but');
    } else if (rand < goalProb + PENALTY_PROB + 0.10) {
      type = 'arret';
      text = pickComment('arret');
    } else if (rand < goalProb + PENALTY_PROB + 0.18) {
      type = 'tir';
      text = pickComment('tir_cadre');
    } else if (rand < goalProb + PENALTY_PROB + 0.24) {
      type = 'info';
      text = pickComment('hors_jeu');
    } else if (rand < goalProb + PENALTY_PROB + 0.40) {
      const defRoll = Math.random();

      if (defRoll < RED_CARD_PROB) {
        isRed = true;
        type  = 'carton_rouge';
        text  = pickComment('carton_rouge_direct');
      } else if (defRoll < RED_CARD_PROB + YELLOW_CARD_PROB) {
        isYellow = true;
        type     = 'carton_jaune';
        text     = pickComment('carton_jaune');
      } else if (defRoll < RED_CARD_PROB + YELLOW_CARD_PROB + INJURY_PROB) {
        isInjury = true;
        type     = 'blessure';
        text     = pickComment('blessure');
      } else {
        type = 'defense';
        text = pickComment('pressing');
      }
    } else {
      type = 'info';
      text = pickComment('passe');
    }

    const filledText = fillComment(text, vars);

    // FIX v3.9 : snapshot des rosters actifs embarqué dans chaque action
    const activeRosterA = activeTitA.map(c => ({ nom: c.nom, id: staminaKey(c), poste: c.position || c.poste }));
    const activeRosterB = activeTitB.map(c => ({ nom: c.nom, id: staminaKey(c), poste: c.position || c.poste }));

    // ── PENALTY ──
    if (isPenalty) {
      const penTaker    = getBestPenaltyTaker({ titulaires: attActive });
      const penTakerNom = cleanName(penTaker?.nom) || vars.att;
      const penTeamId   = aAttacks ? teamA.userId : teamB.userId;

      penaltyMinutesGenerated.add(minute); // FIX v3.9 : marquer cette minute

      actions.push({
        minute,
        text:         filledText,
        type:         'penalty',
        isPenalty:    true,
        teamId:       penTeamId,
        embedColor:   getEmbedColor(penTeamId, teamIdA),
        penTakerNom,
        penTakerCard: penTaker,
        joueurNom:    penTakerNom,
        joueurId:     penTaker ? staminaKey(penTaker) : null, // FIX v3.9
        scoreA,
        scoreB,
        activeRosterA, // FIX v3.9
        activeRosterB, // FIX v3.9
      });

    // ── BUT ──
    } else if (isBut) {
      // FIX v3.9 : ne pas générer un but à une minute déjà marquée penalty
      if (penaltyMinutesGenerated.has(minute)) {
        actions.push({ minute, text: filledText, type: 'info', scoreA, scoreB, activeRosterA, activeRosterB });
        continue;
      }

      const buteurCard = randomFrom(attActive.filter(c =>
        c.position === 'Attaquant' || c.poste === 'Attaquant' ||
        c.position === 'Milieu'    || c.poste === 'Milieu'
      )) || randomFrom(attActive);

      const buteurNom = buteurCard ? cleanName(buteurCard.nom) : vars.att;
      const buteurId  = buteurCard ? staminaKey(buteurCard) : null;

      if (aAttacks) {
        scoreA++;
        buteursA.push({ nom: buteurNom, id: buteurId, minute });
        for (const c of (teamB.titulaires || [])) {
          const posteC = getPosteNormalized(c);
          if (['Défenseur', 'Gardien'].includes(posteC)) {
            const key    = staminaKey(c);
            const floorC = getStaminaFloor(posteC);
            staminaB[key] = Math.max(floorC, (staminaB[key] ?? 100) - STAMINA_CONCEDE_GOAL[posteC]);
          }
        }
      } else {
        scoreB++;
        buteursB.push({ nom: buteurNom, id: buteurId, minute });
        for (const c of (teamA.titulaires || [])) {
          const posteC = getPosteNormalized(c);
          if (['Défenseur', 'Gardien'].includes(posteC)) {
            const key    = staminaKey(c);
            const floorC = getStaminaFloor(posteC);
            staminaA[key] = Math.max(floorC, (staminaA[key] ?? 100) - STAMINA_CONCEDE_GOAL[posteC]);
          }
        }
      }

      actions.push({
        minute,
        text:      filledText,
        type:      'but',
        isBut:     true,
        scoreA,
        scoreB,
        teamId:    aAttacks ? teamA.userId : teamB.userId,
        joueurNom: buteurNom,
        joueurId:  buteurId, // FIX v3.9
        activeRosterA,
        activeRosterB,
      });

    // ── CARTON JAUNE / ROUGE ──
    } else if (isYellow || isRed) {
      // FIX v3.9 : pool depuis les joueurs actifs uniquement
      const defPool = defActive.filter(c =>
        ['Défenseur', 'Milieu'].includes(getPosteNormalized(c))
      );
      const availablePool = defPool.length ? defPool : defActive;

      if (!availablePool.length) {
        actions.push({ minute, text: fillComment(pickComment('pressing'), vars), type: 'defense', scoreA, scoreB, activeRosterA, activeRosterB });
        continue;
      }

      const carded    = randomFrom(availablePool);
      const cardedNom = cleanName(carded?.nom) || vars.def;
      const cardedId  = carded ? staminaKey(carded) : null;

      const cardTeamId = aAttacks ? teamB.userId : teamA.userId;
      const isTeamA    = cardTeamId === teamA.userId;
      const cardKey    = `${cardTeamId}_${cardedId || cardedNom}`;

      let finalType   = 'carton_jaune';
      let finalText   = fillComment(pickComment('carton_jaune'), { ...vars, def: cardedNom });
      let isExpulsion = false;

      if (isRed) {
        const quota = isTeamA ? redCardsA : redCardsB;
        if (quota >= 1) {
          yellowCards[cardKey] = (yellowCards[cardKey] || 0) + 1;
          finalType   = 'carton_jaune';
          finalText   = fillComment(pickComment('carton_jaune'), { ...vars, def: cardedNom });
          isExpulsion = false;
        } else {
          finalType   = 'carton_rouge';
          finalText   = fillComment(pickComment('carton_rouge_direct'), { ...vars, def: cardedNom });
          isExpulsion = true;
          if (isTeamA) redCardsA++;
          else         redCardsB++;
        }
      } else {
        const prevYellows = yellowCards[cardKey] || 0;
        yellowCards[cardKey] = prevYellows + 1;

        if (prevYellows >= 1) {
          const quota = isTeamA ? redCardsA : redCardsB;
          if (quota >= 1) {
            finalType   = 'carton_jaune';
            finalText   = fillComment(pickComment('carton_jaune'), { ...vars, def: cardedNom });
            isExpulsion = false;
          } else {
            finalType   = 'carton_rouge';
            finalText   = fillComment(pickComment('carton_rouge_2jaunes'), { ...vars, def: cardedNom });
            isExpulsion = true;
            if (isTeamA) redCardsA++;
            else         redCardsB++;
          }
        }
      }

      if (isExpulsion) {
        if (aAttacks) suspendedB[cardedNom] = true;
        else          suspendedA[cardedNom] = true;
      }

      actions.push({
        minute,
        text:       finalText,
        type:       finalType,
        teamId:     cardTeamId,
        embedColor: getEmbedColor(cardTeamId, teamIdA),
        joueurNom:  cardedNom,
        joueurId:   cardedId, // FIX v3.9
        joueurCard: carded,
        isExpulsion,
        isCarton:   true,
        isJaune:    !isExpulsion,
        scoreA,
        scoreB,
        activeRosterA,
        activeRosterB,
      });

    // ── BLESSURE ──
    } else if (isInjury) {
      // FIX v3.9 : pool depuis les joueurs actifs des deux équipes (hors GK de préférence)
      const allActive = [...attActive, ...defActive];
      const injPool   = allActive.filter(c => getPosteNormalized(c) !== 'Gardien');
      const injured   = randomFrom(injPool.length ? injPool : allActive);
      const injuredNom = injured ? cleanName(injured.nom) : vars.def;
      const injuredId  = injured ? staminaKey(injured) : null;

      // Déterminer l'équipe du blessé
      const injTeamId = attActive.includes(injured)
        ? (aAttacks ? teamA.userId : teamB.userId)
        : (aAttacks ? teamB.userId : teamA.userId);

      // FIX v3.9 : marquer le joueur comme blessé immédiatement
      if (aAttacks) {
        if (attActive.includes(injured)) injuredA.add(injuredNom);
        else injuredB.add(injuredNom);
      } else {
        if (attActive.includes(injured)) injuredB.add(injuredNom);
        else injuredA.add(injuredNom);
      }

      actions.push({
        minute,
        text:        fillComment(pickComment('blessure'), { ...vars, def: injuredNom }),
        type:        'blessure',
        teamId:      injTeamId,
        embedColor:  getEmbedColor(injTeamId, teamIdA),
        joueurNom:   injuredNom,
        joueurId:    injuredId, // FIX v3.9
        joueurCard:  injured,
        isBlessure:  true,
        needsSub:    true,
        scoreA,
        scoreB,
        activeRosterA,
        activeRosterB,
      });

    } else {
      actions.push({
        minute, text: filledText, type, scoreA, scoreB,
        activeRosterA, activeRosterB,
      });
    }
  }

  Object.assign(staminaA, updateStamina(staminaA, teamA, 45, scoreB));
  Object.assign(staminaB, updateStamina(staminaB, teamB, 45, scoreA));

  return {
    actions,
    buteursA,
    buteursB,
    scoreA,
    scoreB,
    yellowCards,
    suspendedA,
    suspendedB,
    injuredA,     // FIX v3.9 : propagé à la 2e mi-temps
    injuredB,
    addedTime,
    redCardsA,
    redCardsB,
    penaltyMinutes: [...penaltyMinutesGenerated], // FIX v3.9 : exposé pour match.js
  };
}

// ==================== SIMULATION COMPLÈTE ====================

function simulateMatch(teamA, teamB) {
  const strA = getTeamStrength(teamA, teamA.formation);
  const strB = getTeamStrength(teamB, teamB.formation);

  const staminaA    = initStamina(teamA);
  const staminaB    = initStamina(teamB);
  const yellowCards = {};
  const suspendedA  = {};
  const suspendedB  = {};
  const injuredA    = new Set(); // FIX v3.9
  const injuredB    = new Set(); // FIX v3.9

  let scoreA = 0;
  let scoreB = 0;

  const half1 = simulateHalf(
    teamA, teamB, strA, strB,
    staminaA, staminaB,
    scoreA, scoreB,
    yellowCards, suspendedA, suspendedB,
    1,
    0, 0,
    injuredA, injuredB, // FIX v3.9
  );
  scoreA = half1.scoreA;
  scoreB = half1.scoreB;

  const staminaHalftimeA = { ...staminaA };
  const staminaHalftimeB = { ...staminaB };

  const half2 = simulateHalf(
    teamA, teamB, strA, strB,
    staminaA, staminaB,
    scoreA, scoreB,
    half1.yellowCards, half1.suspendedA, half1.suspendedB,
    2,
    half1.redCardsA,
    half1.redCardsB,
    half1.injuredA, // FIX v3.9 : propagation des blessés
    half1.injuredB,
  );
  scoreA = half2.scoreA;
  scoreB = half2.scoreB;

  const buteursA = [...half1.buteursA, ...half2.buteursA];
  const buteursB = [...half1.buteursB, ...half2.buteursB];
  const winner   = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw';

  return {
    firstHalf:  half1.actions,
    secondHalf: half2.actions,
    addedTimeHT1: half1.addedTime,
    addedTimeHT2: half2.addedTime,
    scoreA,
    scoreB,
    buteursA,
    buteursB,
    winner,
    strA,
    strB,
    staminaA,
    staminaB,
    staminaHalftimeA,
    staminaHalftimeB,
    yellowCards: half2.yellowCards,
    suspendedA:  half2.suspendedA,
    suspendedB:  half2.suspendedB,
    injuredA:    half2.injuredA, // FIX v3.9
    injuredB:    half2.injuredB,
    redCardsA:   half2.redCardsA,
    redCardsB:   half2.redCardsB,
    // FIX v3.9 : toutes les minutes penalty des deux mi-temps
    penaltyMinutes: [...(half1.penaltyMinutes || []), ...(half2.penaltyMinutes || [])],
  };
}

// ==================== HELPERS COMPAT ====================

function splitActions(result) {
  return {
    firstHalf:  result.firstHalf  || [],
    secondHalf: result.secondHalf || [],
  };
}

function formatActionsBlock(actions) {
  return actions.map(a => `\`${String(a.minute).padStart(2, ' ')}'\` ${a.text}`).join('\n');
}

function buildMatchSummary(teamA, teamB, result) {
  const { scoreA, scoreB, buteursA, buteursB, winner } = result;
  const formatButeurs = (list) =>
    list.length
      ? list.map(b => `• ⚽ But de **${cleanName(b.nom)}** (${b.minute}')`).join('\n')
      : '• Aucun but';
  return {
    score:        `${scoreA} — ${scoreB}`,
    winner,
    teamALabel:   teamA.userName,
    teamBLabel:   teamB.userName,
    buteursAText: formatButeurs(buteursA),
    buteursBText: formatButeurs(buteursB),
  };
}

function formatStaminaDisplay(team, stamina, label) {
  const lines = (team.titulaires || []).map(card => {
    const key = staminaKey(card);
    const val = Math.round(stamina[key] || 0);
    const bar = buildStaminaBar(val);
    const flag = val < 40 ? ' ⚠️' : val < 55 ? ' 😓' : '';
    return `• **${shortName(card.nom)}** (${card.position || card.poste}) — ${bar} ${val}%${flag}`;
  });
  return `**📊 Stamina de l'équipe de ${label}**\n${lines.join('\n')}`;
}

function buildStaminaBar(val) {
  const filled = Math.round(val / 10);
  const empty  = 10 - filled;
  const color  = val >= 70 ? '🟩' : val >= 45 ? '🟨' : '🟥';
  return color.repeat(filled) + '⬛'.repeat(empty);
}

// ==================== EXPORTS ====================

module.exports = {
  simulateMatch,
  splitActions,
  formatActionsBlock,
  buildMatchSummary,
  formatStaminaDisplay,
  initStamina,
  updateStamina,
  getBestPenaltyTaker,
  staminaFactor,
  defenseStaminaFactor,
  getPosteNormalized,
  staminaKey,      // FIX v3.9 : exposé pour match.js
  HALFTIME,
  shortName,
  cleanName,
  pickComment,
  fillComment,
};