'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// commentaryEngine.js  v13.2
//
// CHANGEMENTS v13.2 :
//   - JOUEURS HORS-JEU : pickPlayerName, pickGoalkeeperName et toutes les
//     fonctions de sélection reçoivent un Set `unavailable` (noms nettoyés
//     des joueurs expulsés, blessés, sortis). Aucun commentaire ne peut
//     mentionner un joueur absent du terrain.
//     generateCommentaires construit unavailableA/B depuis les rawActions
//     reçues (carton_rouge, blessure, expulsion) en plus du activeRoster
//     embarqué dans chaque action par matchEngine v3.9.
//   - IDs JOUEURS : quand une rawAction embarque joueurId, le nom nettoyé
//     est résolu depuis le roster de l'équipe pour éviter tout conflit de
//     noms identiques avec des IDs différents.
//   - GAPS COMMENTAIRES : MAX_GAP réduit à 4 pour correspondre à
//     matchEngine v3.9. fillMinuteGaps renforcé avec un premier remplissage
//     systématique dès le début de mi-temps.
//   - SCORE PENALTY (complément v3.7/3.8) : les commentaires isBut à des
//     minutes dans penaltyMinutes sont systématiquement neutralisés
//     (isBut=false, pas de mise à jour du score live).
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');

// ─── FALLBACKS D'URGENCE ─────────────────────────────────────────────────────
const FB = {
  construction : '{j} s\'avance vers la surface adverse.',
  finition     : '{j} frappe au but !',
  celebration  : 'BUT ! {j} marque !',
  danger       : '{j} se retrouve face au but !',
  parade       : 'Arrêt du gardien !',
  tir_cadre    : '{j} frappe — repoussé par le gardien !',
  tir_hors     : '{j} frappe — le ballon passe à côté !',
  filler       : 'Action en cours…',
  added_time   : '⏱️ {t} minutes de temps additionnel !',
};

// ─── CHARGEMENT DB ───────────────────────────────────────────────────────────
let _db = null;
function getDB() {
  if (_db) return _db;
  const p = path.join(__dirname, '../data/scenarios/commentary.json');
  _db = JSON.parse(fs.readFileSync(p, 'utf8'));
  return _db;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickFresh(arr, lastUsed) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  const filtered = arr.filter(x => x !== lastUsed);
  return pick(filtered.length ? filtered : arr);
}

function render(template, joueur, t) {
  if (!template) return '';
  let out = template;
  if (joueur) {
    out = out.replace(/\{j\}/g, joueur);
  } else {
    out = out.replace(/\{j\}/g, '').replace(/  +/g, ' ').trim();
  }
  if (t !== undefined && t !== null) {
    out = out.replace(/\{t\}/g, String(t));
  }
  return out;
}

// ─── NETTOYAGE DES NOMS ──────────────────────────────────────────────────────
const NAME_EXCLUDED = new Set([
  'Home','Away','Third','Fourth','Civil','Invictus','Héros','Hero',
  'Legend','Légende','Icon','Icône','Prime','Future','Flashback',
  'Storyline','Record','Breaker','Showdown','Headliner','Totw',
  'Toty','Community','Shapeshifter','Rulebreaker','Vintage','EDF',
  'Era','Edt','Sbc','Obj','Fut','Wc','Ucl','Uel','Uecl','Starter',
  'Tuchel','Luis','Enrique','Blanc','Kombouaré','Emery',
]);
const SUFFIX_NOISE = /^(Jr\.?|Sr\.?|II|III|IV|Era|Edt|Tuchel)$/i;

function cleanName(nom) {
  if (!nom) return null;
  const parts = nom
    .split(' ')
    .map(p => p.replace(/^\(+|\)+$/g, ''))
    .filter(p =>
      p !== '' &&
      !/^\d{2}\/\d{2}$/.test(p) &&
      !NAME_EXCLUDED.has(p) &&
      !SUFFIX_NOISE.test(p)
    );
  if (!parts.length) return nom.split(' ').pop() || nom;
  return parts.join(' ');
}

// ─── CATÉGORIE DE POSTE ──────────────────────────────────────────────────────
function getCategorie(poste) {
  if (!poste) return 'milieu';
  const p = poste.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (p.includes('gard'))                                                                  return 'gardien';
  if (p.includes('def') || p.includes('lat') || p.includes('stop') || p.includes('lib')) return 'défenseur';
  if (p.includes('att') || p.includes('avant') || p.includes('bu'))                       return 'attaquant';
  return 'milieu';
}

// ─── SÉLECTION DE JOUEURS ────────────────────────────────────────────────────
// FIX v13.2 : unavailable = Set des noms nettoyés des joueurs hors terrain

function pickPlayerName(team, categories = null, excludeName = null, unavailable = null) {
  const titulaires = team?.titulaires || [];
  let pool = titulaires.filter(j => {
    if (!j.nom) return false;
    // FIX v13.2 : exclure les joueurs hors terrain
    if (unavailable && unavailable.has(cleanName(j.nom))) return false;
    return true;
  });

  if (categories && categories.length) {
    const filtered = pool.filter(j => categories.includes(getCategorie(j.poste || j.position || '')));
    pool = filtered.length ? filtered : pool.filter(j => getCategorie(j.poste || '') !== 'gardien');
  }

  if (excludeName && pool.length > 1) {
    const filtered = pool.filter(j => cleanName(j.nom) !== excludeName);
    if (filtered.length) pool = filtered;
  }

  const p = pick(pool);
  return p ? cleanName(p.nom) : null;
}

function pickGoalkeeperName(team, unavailable = null) {
  const gks = (team?.titulaires || []).filter(j => {
    if (unavailable && unavailable.has(cleanName(j.nom))) return false;
    return getCategorie(j.poste || j.position || '') === 'gardien';
  });
  if (gks.length) return cleanName(gks[0].nom);
  // Fallback : dernier titulaire disponible
  const avail = (team?.titulaires || []).filter(j =>
    !(unavailable && unavailable.has(cleanName(j.nom)))
  );
  return avail.length ? cleanName(avail[avail.length - 1].nom) : null;
}

function findPlayer(team, nomNettoye) {
  return (team?.titulaires || []).find(j => cleanName(j.nom) === nomNettoye) || null;
}

// FIX v13.2 : résolution du nom depuis l'ID embarqué dans la rawAction
function resolvePlayerNomFromId(team, joueurId) {
  if (!joueurId) return null;
  const card = (team?.titulaires || []).find(c => {
    const key = c.id != null ? String(c.id) : c.nom;
    return key === String(joueurId);
  });
  return card ? cleanName(card.nom) : null;
}

// ─── CONSTRUCTION DU SET unavailable DEPUIS activeRoster ──────────────────────
// FIX v13.2 : si la rawAction embarque activeRosterA/B, on l'utilise directement
// pour construire le pool disponible à cet instant.

function buildUnavailableFromRoster(action, teamUserId, teamA, teamB) {
  const isA       = teamUserId === teamA.userId;
  const roster    = isA ? action.activeRosterA : action.activeRosterB;
  const fullTeam  = isA ? teamA : teamB;

  if (!roster) return new Set(); // pas de roster embarqué → pas de filtre

  const availableNoms = new Set(roster.map(r => cleanName(r.nom)));
  const unavailable   = new Set();
  for (const j of (fullTeam.titulaires || [])) {
    const cn = cleanName(j.nom);
    if (cn && !availableNoms.has(cn)) {
      unavailable.add(cn);
    }
  }
  return unavailable;
}

// ─── POOL PAR POSTE ──────────────────────────────────────────────────────────
function getPoolByPoste(nomNettoye, team, actionType, db) {
  const joueur = findPlayer(team, nomNettoye);
  const cat    = getCategorie(joueur?.poste || joueur?.position || '');

  return (
    db.by_poste?.[cat]?.[actionType] ||
    db.by_poste?.milieu?.[actionType] ||
    db.by_event?.[actionType] ||
    null
  );
}

// ─── DÉTECTION DU TYPE DE BUT ────────────────────────────────────────────────
function detectButType(rawAction) {
  if (!rawAction)            return 'pied';
  if (rawAction.isPenalty)   return 'penalty';
  if (rawAction.isHeader)    return 'tete';
  if (rawAction.isLob)       return 'lob';
  if (rawAction.butType)     return rawAction.butType;

  const r = Math.random();
  if (r < 0.65) return 'pied';
  if (r < 0.90) return 'tete';
  return 'lob';
}

// ─── ÉTAT NARRATIF ───────────────────────────────────────────────────────────
function createNarrativeState() {
  return {
    momentum          : null,
    lastScorer        : null,
    lastScorerTeam    : null,
    consecutiveGoals  : 0,
    gardienEnForme    : null,
    gardienArrets     : {},
    lastActionType    : null,
    lastFillerPool    : null,
    lastFillerText    : null,
    periodeCalme      : 0,
  };
}

function updateNarrativeAfterBut(ns, buteurNom, teamId) {
  if (ns.lastScorerTeam === teamId) {
    ns.consecutiveGoals++;
  } else {
    ns.consecutiveGoals = 1;
  }
  ns.lastScorer     = buteurNom;
  ns.lastScorerTeam = teamId;
  ns.momentum       = teamId;
  ns.lastActionType = 'but';
  ns.periodeCalme   = 0;
}

function updateNarrativeAfterArret(ns, defTeamId) {
  ns.gardienArrets[defTeamId] = (ns.gardienArrets[defTeamId] || 0) + 1;
  if (ns.gardienArrets[defTeamId] >= 2) {
    ns.gardienEnForme = defTeamId;
  }
  ns.lastActionType = 'arret';
  ns.periodeCalme   = 0;
}

// ─── SÉLECTION DU POOL DE FILLER ─────────────────────────────────────────────
function pickContextPool(minute, offset, sA, sB, teamAId, ns) {
  const absMinute    = offset + minute - offset;
  const isSecondHalf = offset >= 46;
  const diff         = Math.abs(sA - sB);

  if (absMinute >= 75)                           return 'death_zone';
  if (isSecondHalf && absMinute <= 52)           return 'halftime_restart';
  if (ns.consecutiveGoals >= 2 && diff <= 1)     return 'comeback';

  if (diff >= 2) {
    return (sA > sB)
      ? (ns.lastScorerTeam === teamAId ? 'winning' : 'losing')
      : (ns.lastScorerTeam === teamAId ? 'losing'  : 'winning');
  }

  if (ns.momentum) return 'pressure';
  return 'draw';
}

// ─── REMPLISSAGE DES TROUS ───────────────────────────────────────────────────
// FIX v13.2 : MAX_GAP réduit à 4

const MAX_GAP = 4;

function fillMinuteGaps(from, to, usedMinutes) {
  const sorted = [...usedMinutes]
    .filter(m => typeof m === 'number' && m >= from && m <= to)
    .sort((a, b) => a - b);
  const extra = [];

  // Gap au début (from → première action)
  const firstUsed = sorted[0] ?? (to + 1);
  if (firstUsed - from > MAX_GAP) {
    let cursor = from;
    while (firstUsed - cursor > MAX_GAP) {
      const fill = cursor + 1 + Math.floor(Math.random() * Math.min(MAX_GAP - 1, firstUsed - cursor - 1));
      const clamped = Math.min(fill, firstUsed - 1);
      if (clamped > cursor && !usedMinutes.has(clamped)) {
        extra.push(clamped);
        cursor = clamped;
      } else {
        cursor++;
      }
    }
  }

  // Gaps entre actions
  for (let i = 0; i < sorted.length - 1; i++) {
    let cursor = sorted[i];
    const next = sorted[i + 1];
    while (next - cursor > MAX_GAP) {
      const fill    = cursor + 1 + Math.floor(Math.random() * Math.min(MAX_GAP - 1, next - cursor - 1));
      const clamped = Math.min(fill, next - 1);
      if (clamped > cursor && !usedMinutes.has(clamped)) {
        extra.push(clamped);
        cursor = clamped;
      } else {
        cursor++;
      }
    }
  }

  // Gap à la fin (dernière action → to)
  const last = sorted[sorted.length - 1] ?? (from - 1);
  if (to - last > MAX_GAP) {
    let cursor = last;
    while (to - cursor > MAX_GAP) {
      const fill = cursor + 1 + Math.floor(Math.random() * Math.min(MAX_GAP - 1, to - cursor - 1));
      const clamped = Math.min(fill, to);
      if (clamped > cursor && !usedMinutes.has(clamped)) {
        extra.push(clamped);
        cursor = clamped;
      } else {
        cursor++;
      }
    }
  }

  return extra.filter(m => m >= from && m <= to && !usedMinutes.has(m));
}

// ─── CONSTRUCTION FILLER ─────────────────────────────────────────────────────
function buildFiller(minute, sA, sB, teamA, teamB, offset, ns, db, fillCount, unavailableA, unavailableB) {
  if (fillCount % 4 === 3) {
    const t = pickFresh(db.by_event?.ambiance, ns.lastFillerText);
    if (t) {
      ns.lastFillerText = t;
      const teamId = fillCount % 8 === 3 ? teamA.userId : teamB.userId;
      return { minute, texte: t, isBut: false, teamId, joueur: null, isFiller: true };
    }
  }

  const poolKey = pickContextPool(minute, offset, sA, sB, teamA.userId, ns);
  const pool    = db.by_context?.[poolKey];
  const texte   = pickFresh(pool, ns.lastFillerText) || FB.filler;

  let teamId = null;
  if (poolKey === 'winning') {
    teamId = sA >= sB ? teamA.userId : teamB.userId;
  } else if (poolKey === 'losing') {
    teamId = sA < sB ? teamA.userId : teamB.userId;
  } else if (poolKey === 'pressure' && ns.momentum) {
    teamId = ns.momentum;
  } else if (poolKey === 'comeback' && ns.lastScorerTeam) {
    teamId = ns.lastScorerTeam;
  } else {
    teamId = fillCount % 2 === 0 ? teamA.userId : teamB.userId;
  }

  ns.lastFillerPool = poolKey;
  ns.lastFillerText = texte;
  ns.lastActionType = 'filler';
  ns.periodeCalme++;

  return { minute, texte, isBut: false, teamId, joueur: null, isFiller: true };
}

// ─── SÉQUENCE BUT (3 messages) ───────────────────────────────────────────────
function buildButSequence(minute, buteurNom, butType, attackTeam, defTeam, sA, sB, teamAId, ns, db, unavailableAtt, unavailableDef) {
  const constrKey = `construction_${butType}`;
  const finKey    = `finition_${butType}`;

  // FIX v13.2 : exclure les joueurs hors terrain dans la sélection
  const constrJoueur = pickPlayerName(attackTeam, ['attaquant', 'milieu'], buteurNom, unavailableAtt) || buteurNom;

  const tplConstruction = pick(db.sequences?.but?.[constrKey])
    || pick(db.sequences?.but?.construction_pied)
    || FB.construction;

  const tplFinition = pick(db.sequences?.but?.[finKey])
    || pick(db.sequences?.but?.finition_pied)
    || FB.finition;

  const tplCelebration = pick(db.sequences?.but?.celebration)
    || pick(db.by_event?.but)
    || FB.celebration;

  const isTeamA   = attackTeam.userId === teamAId;
  const newScoreA = isTeamA ? sA + 1 : sA;
  const newScoreB = isTeamA ? sB : sB + 1;

  return [
    {
      minute,
      texte  : render(tplConstruction, constrJoueur),
      isBut  : false,
      teamId : attackTeam.userId,
      joueur : constrJoueur,
      _phase : 'construction',
    },
    {
      minute,
      texte  : render(tplFinition, buteurNom),
      isBut  : false,
      teamId : attackTeam.userId,
      joueur : buteurNom,
      _phase : 'finition',
    },
    {
      minute,
      texte  : render(tplCelebration, buteurNom),
      isBut  : true,
      scoreA : newScoreA,
      scoreB : newScoreB,
      teamId : attackTeam.userId,
      joueur : buteurNom,
      _phase : 'celebration',
    },
  ];
}

// ─── SÉQUENCE ARRÊT GARDIEN (2 messages) ─────────────────────────────────────
function buildArretSequence(minute, attackTeam, defTeam, ns, db, unavailableAtt, unavailableDef) {
  // FIX v13.2 : respecter unavailable pour les deux équipes
  const attaquantNom = pickPlayerName(attackTeam, ['attaquant', 'milieu'], null, unavailableAtt) || 'l\'attaquant';
  const gardienNom   = pickGoalkeeperName(defTeam, unavailableDef) || 'le gardien';

  const dangerPool = getPoolByPoste(attaquantNom, attackTeam, 'tir_cadre', db);
  const tplDanger  = pick(dangerPool)
    || pick(db.sequences?.arret?.danger)
    || FB.danger;

  const paradePool = getPoolByPoste(gardienNom, defTeam, 'arret', db);
  const tplParade  = pick(paradePool)
    || pick(db.sequences?.arret?.parade)
    || pick(db.by_event?.arret)
    || FB.parade;

  updateNarrativeAfterArret(ns, defTeam.userId);

  return [
    {
      minute,
      texte  : render(tplDanger, attaquantNom),
      isBut  : false,
      teamId : attackTeam.userId,
      joueur : attaquantNom,
      _phase : 'danger',
    },
    {
      minute,
      texte  : render(tplParade, gardienNom),
      isBut  : false,
      teamId : defTeam.userId,
      joueur : gardienNom,
      _phase : 'parade',
    },
  ];
}

// ─── ACTION SIMPLE ───────────────────────────────────────────────────────────
function buildActionComment(minute, type, attackTeam, rawAction, db, unavailableAtt) {
  // FIX v13.2 : résoudre d'abord depuis l'ID, puis depuis le nom
  let joueurNom = null;
  if (rawAction?.joueurId) {
    joueurNom = resolvePlayerNomFromId(attackTeam, rawAction.joueurId);
  }
  if (!joueurNom && rawAction?.joueurNom) {
    joueurNom = cleanName(rawAction.joueurNom);
  }
  if (!joueurNom) {
    joueurNom = pickPlayerName(attackTeam, ['attaquant', 'milieu'], null, unavailableAtt);
  }

  // Vérifier que le joueur est disponible
  if (joueurNom && unavailableAtt && unavailableAtt.has(joueurNom)) {
    joueurNom = pickPlayerName(attackTeam, ['attaquant', 'milieu'], null, unavailableAtt);
  }

  const t = (type || '').toLowerCase();
  let pool = null;

  if (t.includes('hors') || t.includes('hors_cadre')) {
    pool = getPoolByPoste(joueurNom, attackTeam, 'tir_hors_cadre', db)
      || db.sequences?.tir_hors
      || db.by_event?.tir_hors_cadre;
  } else if (t.includes('tir') || t.includes('cadre')) {
    pool = getPoolByPoste(joueurNom, attackTeam, 'tir_cadre', db)
      || db.sequences?.tir_cadre
      || db.by_event?.tir_cadre;
  } else if (t.includes('occasion')) {
    pool = db.sequences?.occasion_manquee
      || db.by_event?.tir_hors_cadre;
  } else {
    pool = db.sequences?.tir_cadre || db.by_event?.tir_cadre;
  }

  const tpl = pick(pool) || FB.tir_cadre;
  return {
    minute,
    texte  : render(tpl, joueurNom),
    isBut  : false,
    teamId : attackTeam.userId,
    joueur : joueurNom,
  };
}

// ─── ÉVÉNEMENT SPÉCIAL ───────────────────────────────────────────────────────
function buildEventComment(minute, type, rawAction, db) {
  // FIX v13.2 : résoudre le joueur depuis l'ID en priorité
  let joueurNom = null;
  if (rawAction?.joueurId && rawAction?._team) {
    joueurNom = resolvePlayerNomFromId(rawAction._team, rawAction.joueurId);
  }
  if (!joueurNom && rawAction?.joueurNom) {
    joueurNom = cleanName(rawAction.joueurNom);
  }

  const teamId = rawAction?.teamId || null;

  let tpl  = null;
  let meta = {};

  const t = (type || '').toLowerCase();

  if (t === 'carton_jaune' || (t.includes('carton') && !t.includes('rouge'))) {
    tpl  = pick(db.by_event?.carton_jaune);
    meta = { isCarton: true, isJaune: true };

  } else if (t === 'carton_rouge' || t.includes('expulsion') || t.includes('rouge')) {
    tpl  = pick(db.by_event?.expulsion);
    meta = { isCarton: true, isExpulsion: true };

  } else if (t === 'penalty' || t.includes('pénalt')) {
    tpl  = pick(db.by_event?.penalty_annonce);
    meta = { isPenaltyAnnonce: true };

  } else if (t === 'but_csc' || t.includes('contre_son_camp') || t.includes('own_goal')) {
    tpl  = pick(db.special?.own_goal);
    meta = { isOwnGoal: true };

  } else if (t === 'penalty_rate' || t.includes('missed_penalty')) {
    tpl  = pick(db.special?.missed_penalty);
    meta = { isMissedPenalty: true };

  } else if (t === 'penalty_arrete' || t.includes('saved_penalty')) {
    tpl  = pick(db.special?.saved_penalty);
    meta = { isSavedPenalty: true };

  } else if (t === 'blessure' || t.includes('injur')) {
    tpl  = pick(db.special?.injury);
    meta = { isBlessure: true };

  } else if (t === 'remplacement' || t.includes('subst')) {
    tpl  = pick(db.special?.substitution);
    meta = { isSubstitution: true };

  } else if (t === 'var' || t.includes('var_check')) {
    tpl  = pick(db.special?.var_check || db.by_event?.var_check);
    meta = { isVar: true };

  } else if (t === 'corner') {
    tpl  = pick(db.by_event?.corner);

  } else if (t === 'coup_franc') {
    tpl  = pick(db.by_event?.coup_franc);

  } else if (t === 'faute') {
    const team = rawAction?._team;
    if (joueurNom && team) {
      tpl = pick(getPoolByPoste(joueurNom, team, 'faute', db));
    }
    tpl = tpl || pick(db.by_event?.faute);
  }

  return {
    minute,
    texte  : render(tpl || `Événement à la ${minute}' !`, joueurNom),
    isBut  : false,
    teamId,
    joueur : joueurNom,
    ...meta,
  };
}

// ─── COMMENTAIRE SPÉCIAL ─────────────────────────────────────────────────────
function applySpecialLayer(celebrationMsg, buteurNom, scorerCount, minute, endMinute, db) {
  const cnt       = scorerCount[buteurNom] || 1;
  const isEndGame = minute >= endMinute - 5;

  if (cnt === 2) {
    const brace = pick(db.special?.brace);
    if (brace) celebrationMsg.texte = render(brace, buteurNom);

    if (!isEndGame) {
      const imm = pick(db.special?.hat_trick_imminent);
      if (imm) celebrationMsg._extra = { texte: render(imm, buteurNom) };
    }
  }

  if (cnt >= 3) {
    const ht = pick(db.special?.hat_trick);
    celebrationMsg.texte = ht
      ? render(ht, buteurNom)
      : `🎩 HAT-TRICK DE ${buteurNom} ! Prestation absolument légendaire ce soir !`;
  }

  if (isEndGame) {
    const lm = pick(db.special?.last_minute);
    if (lm) celebrationMsg._lastMinute = render(lm, buteurNom);
  }

  return celebrationMsg;
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────────────
/**
 * Génère la liste ordonnée des commentaires pour une mi-temps.
 *
 * FIX v13.2 :
 *   - penaltyMinutes (Set) reçu depuis matchEngine pour bloquer les buts
 *     à ces minutes.
 *   - unavailableA/B construits progressivement à mesure des événements.
 *   - activeRoster embarqué dans les rawActions utilisé quand disponible.
 */
function generateCommentaires(
  actions        = [],
  teamA,
  teamB,
  totalMinutes   = 45,
  offset         = 1,
  score          = { scoreA: 0, scoreB: 0 },
  narrativeState = null,
  addedTime      = 0,
  penaltyMinutes = null, // FIX v13.2 : Set ou Array des minutes penalty
) {
  const db  = getDB();
  const ns  = narrativeState || createNarrativeState();

  if (!teamA || !teamB) {
    console.error('[commentaryEngine] teamA ou teamB manquant');
    return [];
  }

  // FIX v13.2 : normaliser en Set
  const penaltyMinutesSet = penaltyMinutes
    ? new Set(Array.isArray(penaltyMinutes) ? penaltyMinutes : [...penaltyMinutes])
    : new Set();

  const commentaires  = [];
  const usedMinutes   = new Set();
  const scorerCount   = {};

  let sA              = score.scoreA || 0;
  let sB              = score.scoreB || 0;
  let fillCount       = 0;

  const teamAId        = teamA.userId;
  const endMinute      = offset + totalMinutes - 1 + addedTime;
  const addedTimeStart = offset + totalMinutes;
  let addedTimeAnnounced = false;

  // FIX v13.2 : sets des joueurs indisponibles, mis à jour au fil des actions
  const unavailableA = new Set(); // noms nettoyés des joueurs A hors terrain
  const unavailableB = new Set(); // noms nettoyés des joueurs B hors terrain

  // ── TRAITEMENT DES ACTIONS ────────────────────────────────────────────────
  for (const action of actions) {
    const minute = action.minute ?? (offset + Math.floor(Math.random() * totalMinutes));
    const type   = (action.type || '').toLowerCase();

    // Annonce temps additionnel
    if (addedTime > 0 && minute >= addedTimeStart && !addedTimeAnnounced) {
      addedTimeAnnounced = true;
      const taTpl = pick(db.added_time);
      commentaires.push({
        minute : addedTimeStart,
        texte  : render(taTpl || FB.added_time, null, addedTime),
        isBut  : false,
        teamId : sA >= sB ? teamAId : teamB.userId,
        joueur : null,
        isAddedTimeAnnounce: true,
      });
    }

    usedMinutes.add(minute);

    // FIX v13.2 : mettre à jour unavailable depuis activeRoster de l'action
    if (action.activeRosterA) {
      const availNoms = new Set(action.activeRosterA.map(r => cleanName(r.nom)));
      for (const j of (teamA.titulaires || [])) {
        const cn = cleanName(j.nom);
        if (cn && !availNoms.has(cn)) unavailableA.add(cn);
      }
    }
    if (action.activeRosterB) {
      const availNoms = new Set(action.activeRosterB.map(r => cleanName(r.nom)));
      for (const j of (teamB.titulaires || [])) {
        const cn = cleanName(j.nom);
        if (cn && !availNoms.has(cn)) unavailableB.add(cn);
      }
    }

    // ── BUT ────────────────────────────────────────────────────────────────
    if (type === 'but' || type === 'goal') {
      // FIX v13.2 : ignorer les buts à une minute penalty
      if (penaltyMinutesSet.has(minute)) {
        // Commentaire neutre d'attente (penalty va suivre)
        commentaires.push({
          minute,
          texte  : 'Tension extrême dans la surface — la décision n\'est pas encore tombée !',
          isBut  : false,
          teamId : action.teamId || teamAId,
          joueur : null,
          isFiller: true,
        });
        continue;
      }

      const isTeamA    = action.teamId === teamAId;
      const attackTeam = isTeamA ? teamA : teamB;
      const defTeam    = isTeamA ? teamB : teamA;

      const unavailableAtt = isTeamA ? unavailableA : unavailableB;
      const unavailableDef = isTeamA ? unavailableB : unavailableA;

      // FIX v13.2 : résoudre le buteur depuis l'ID en priorité
      let buteurNom = null;
      if (action.joueurId) {
        buteurNom = resolvePlayerNomFromId(attackTeam, action.joueurId);
      }
      if (!buteurNom && action.joueurNom) {
        buteurNom = cleanName(action.joueurNom);
      }
      // Vérifier que le buteur est disponible
      if (buteurNom && unavailableAtt.has(buteurNom)) {
        buteurNom = null;
      }
      if (!buteurNom) {
        buteurNom = pickPlayerName(attackTeam, ['attaquant', 'milieu'], null, unavailableAtt) || 'un attaquant';
      }

      const butType = detectButType(action);
      scorerCount[buteurNom] = (scorerCount[buteurNom] || 0) + 1;

      const seq = buildButSequence(minute, buteurNom, butType, attackTeam, defTeam, sA, sB, teamAId, ns, db, unavailableAtt, unavailableDef);
      applySpecialLayer(seq[2], buteurNom, scorerCount, minute, endMinute, db);

      if (seq[2]._extra) {
        const extra = {
          minute,
          texte  : seq[2]._extra.texte,
          isBut  : false,
          teamId : attackTeam.userId,
          joueur : buteurNom,
          _phase : 'special',
        };
        delete seq[2]._extra;
        commentaires.push(...seq, extra);
      } else {
        commentaires.push(...seq);
      }

      if (action.scoreA !== undefined) sA = action.scoreA;
      else if (isTeamA) sA++;
      if (action.scoreB !== undefined) sB = action.scoreB;
      else if (!isTeamA) sB++;

      seq[2].scoreA = sA;
      seq[2].scoreB = sB;

      updateNarrativeAfterBut(ns, buteurNom, attackTeam.userId);

    // ── ARRÊT GARDIEN ──────────────────────────────────────────────────────
    } else if (type === 'arret' || type.includes('save') || type.includes('arrêt')) {
      const isTeamA    = action.teamId === teamAId;
      const attackTeam = isTeamA ? teamA : teamB;
      const defTeam    = isTeamA ? teamB : teamA;

      const unavailableAtt = isTeamA ? unavailableA : unavailableB;
      const unavailableDef = isTeamA ? unavailableB : unavailableA;

      commentaires.push(...buildArretSequence(minute, attackTeam, defTeam, ns, db, unavailableAtt, unavailableDef));

      const gkCount = ns.gardienArrets[defTeam.userId] || 0;
      if (gkCount === 3) {
        const gkName = pickGoalkeeperName(defTeam, unavailableDef);
        commentaires.push({
          minute,
          texte  : `${gkName} est l'homme du match dans les buts ce soir — ${gkCount} arrêts décisifs !`,
          isBut  : false,
          teamId : defTeam.userId,
          joueur : gkName,
          _phase : 'special',
        });
      }

    // ── ÉVÉNEMENTS SPÉCIAUX ────────────────────────────────────────────────
    } else if (
      type === 'carton_jaune'  || type === 'carton_rouge' ||
      type.includes('expulsion') || type.includes('carton') ||
      type === 'blessure'      || type.includes('injur')  ||
      type === 'penalty'       || type.includes('pénalt') ||
      type === 'but_csc'       || type.includes('own_goal') ||
      type === 'penalty_rate'  || type === 'penalty_arrete' ||
      type === 'remplacement'  || type.includes('subst') ||
      type === 'var'           || type === 'corner' ||
      type === 'coup_franc'    || type === 'faute'
    ) {
      const isTeamA  = action.teamId === teamAId;
      const theTeam  = isTeamA ? teamA : teamB;

      // FIX v13.2 : marquer le joueur blessé/expulsé comme unavailable
      if (type === 'blessure' || type === 'carton_rouge' || type.includes('expulsion')) {
        let nom = null;
        if (action.joueurId) nom = resolvePlayerNomFromId(theTeam, action.joueurId);
        if (!nom && action.joueurNom) nom = cleanName(action.joueurNom);
        if (nom) {
          if (isTeamA) unavailableA.add(nom);
          else         unavailableB.add(nom);
        }
      }

      const enriched = {
        ...action,
        teamId: action.teamId || null,
        _team : theTeam,
      };
      commentaires.push(buildEventComment(minute, type, enriched, db));

    // ── ACTIONS DE JEU ─────────────────────────────────────────────────────
    } else if (
      type.includes('tir') || type.includes('occasion') ||
      type === 'tir_cadre' || type === 'tir_hors_cadre'
    ) {
      const isTeamA    = action.teamId === teamAId;
      const attackTeam = isTeamA ? teamA : teamB;
      const unavailableAtt = isTeamA ? unavailableA : unavailableB;

      commentaires.push(buildActionComment(minute, type, attackTeam, action, db, unavailableAtt));
      ns.lastActionType = 'tir';

    // ── ACTIONS INFO ───────────────────────────────────────────────────────
    } else {
      if (action.teamId) ns.momentum = action.teamId;
    }
  }

  // Annonce TA si jamais émise
  if (addedTime > 0 && !addedTimeAnnounced) {
    const taTpl = pick(db.added_time);
    commentaires.push({
      minute : addedTimeStart,
      texte  : render(taTpl || FB.added_time, null, addedTime),
      isBut  : false,
      teamId : sA >= sB ? teamAId : teamB.userId,
      joueur : null,
      isAddedTimeAnnounce: true,
    });
  }

  // ── REMPLISSAGE DES TROUS ──────────────────────────────────────────────────
  const gapMinutes = fillMinuteGaps(offset, endMinute, usedMinutes);

  for (const m of gapMinutes) {
    if (usedMinutes.has(m)) continue;
    usedMinutes.add(m);
    commentaires.push(buildFiller(m, sA, sB, teamA, teamB, offset, ns, db, fillCount++, unavailableA, unavailableB));
  }

  // Compléter si mi-temps très calme
  let safety = 0;
  while (commentaires.length < 12 && safety++ < 200) {
    const m = offset + 1 + Math.floor(Math.random() * (totalMinutes + addedTime - 2));
    if (usedMinutes.has(m)) continue;
    usedMinutes.add(m);
    commentaires.push(buildFiller(m, sA, sB, teamA, teamB, offset, ns, db, fillCount++, unavailableA, unavailableB));
  }

  // ── TRI FINAL ──────────────────────────────────────────────────────────────
  const PHASE_ORDER = { construction: 0, danger: 0, finition: 1, parade: 1, celebration: 2, special: 3 };

  commentaires.sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute;
    return (PHASE_ORDER[a._phase] ?? 4) - (PHASE_ORDER[b._phase] ?? 4);
  });

  return commentaires;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  generateCommentaires,
  generateCommentairesV2: generateCommentaires,
  createNarrativeState,
  cleanName,
  getCategorie,
  detectButType,
  pickContextPool,
};