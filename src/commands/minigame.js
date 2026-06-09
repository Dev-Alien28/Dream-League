// src/commands/minigame.js - Système PSG Encounter
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const {
  getMinigameChannel, setMinigameChannel,
  scheduleNextMinigame, getNextMinigameTime,
  addCardToUser, loadPackCards,
  getPackAnnounceChannel, getUserData,
  getEncounterConfig, formatIntervalMs,
} = require('../utils/database');
const {
  PSG_BLUE, PSG_RED, MINIGAME_CONFIG, PSG_FOOTER_ICON, PACKS_CONFIG, CARD_TYPES,
} = require('../config/settings');
const {
  getRarityColor, getRarityEmoji, formatCardStats, weightedRandom,
} = require('../utils/cardHelpers');
const { checkRolePermission } = require('../utils/permissions');
const { logMinigameWin } = require('../utils/logs');
const fs   = require('fs');
const path = require('path');

const ENCOUNTER_COLOR = 0xFDF1B8;

const PSG_QUESTIONS_FALLBACK = [
  { question: 'En quelle année le PSG a-t-il été fondé ?',                                          answers: ['1970', '1965', '1975', '1980'],                                              correct: 0 },
  { question: 'Quel joueur détient le record de buts au PSG ?',                                     answers: ['Zlatan Ibrahimović', 'Edinson Cavani', 'Kylian Mbappé', 'Pauleta'],           correct: 1 },
  { question: 'Quel est le surnom du PSG ?',                                                        answers: ['Les Rouges', 'Les Parisiens', 'Les Bleus', 'Les Princes'],                    correct: 1 },
  { question: 'En quelle année le PSG a-t-il atteint sa première finale de Ligue des Champions ?', answers: ['2015', '2018', '2020', '2021'],                                              correct: 2 },
  { question: 'Quel est le nom du stade du PSG ?',                                                  answers: ['Stade de France', 'Parc des Princes', 'Stade Vélodrome', 'Allianz Riviera'], correct: 1 },
  { question: 'Qui est le président actuel du PSG ?',                                               answers: ['Jean-Michel Aulas', 'Nasser Al-Khelaïfi', 'Frank McCourt', 'Vincent Labrune'], correct: 1 },
  { question: 'Quel joueur brésilien légendaire a porté le maillot du PSG ?',                       answers: ['Ronaldo', 'Ronaldinho', 'Rivaldo', 'Romário'],                                correct: 1 },
  { question: 'Quelle est la capacité du Parc des Princes ?',                                       answers: ['45 000', '48 000', '50 000', '55 000'],                                      correct: 1 },
  { question: 'En quelle année le Qatar a-t-il racheté le PSG ?',                                   answers: ['2009', '2011', '2013', '2015'],                                              correct: 1 },
  { question: 'Quel est le rival historique du PSG ?',                                              answers: ['Lyon', 'Marseille', 'Monaco', 'Lille'],                                      correct: 1 },
  { question: "Qui est l'entraîneur du PSG depuis 2023 ?",                                         answers: ['Thomas Tuchel', 'Mauricio Pochettino', 'Luis Enrique', 'Christophe Galtier'], correct: 2 },
  { question: 'Quel gardien italien joue au PSG ?',                                                 answers: ['Gianluigi Buffon', 'Gianluigi Donnarumma', 'Salvatore Sirigu', 'Mattia Perin'], correct: 1 },
  { question: "En quelle année Neymar a-t-il rejoint le PSG ?",                                    answers: ['2016', '2017', '2018', '2019'],                                              correct: 1 },
  { question: 'Combien a coûté le transfert de Neymar au PSG ?',                                   answers: ['200 millions', '222 millions', '250 millions', '300 millions'],               correct: 1 },
  { question: 'Quel défenseur marocain joue au PSG ?',                                             answers: ['Achraf Hakimi', 'Hakim Ziyech', 'Noussair Mazraoui', 'Romain Saïss'],        correct: 0 },
  { question: 'Quel pays représente Marquinhos ?',                                                  answers: ['Argentine', 'Brésil', 'Portugal', 'Espagne'],                                correct: 1 },
  { question: 'En quelle année le PSG a-t-il remporté son premier titre de champion de France ?',  answers: ['1986', '1990', '1994', '1998'],                                              correct: 0 },
];

// ─── Chargement des cartes Encounter ─────────────────────────────────────────

function loadEncounterCards() {
  const filepath = path.join(__dirname, '..', 'data', 'packs', 'pack_encounter.json');
  if (!fs.existsSync(filepath)) {
    console.warn('⚠️  pack_encounter.json introuvable — mode questions PSG uniquement');
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch (e) {
    console.error('❌ Erreur lecture pack_encounter.json:', e.message);
    return [];
  }
}

const activeEncounters = new Map();

// ─── Helpers image ────────────────────────────────────────────────────────────

function getCardImageAttachment(card) {
  const imagePath = card.image || '';
  if (!imagePath || imagePath.startsWith('http')) return null;
  const absolutePath = path.join(__dirname, '..', imagePath);
  if (fs.existsSync(absolutePath)) {
    try { return new AttachmentBuilder(absolutePath, { name: path.basename(absolutePath) }); }
    catch { return null; }
  }
  return null;
}

function getCardImageUrlSafe(card) {
  const img = card.image || '';
  if ((img.startsWith('http://') || img.startsWith('https://')) && img.length <= 2048) return img;
  return null;
}

// ─── Annonce publique dans le salon pack_announce ─────────────────────────────

async function announceEncounterWin(guild, winner, card, guildId) {
  const announceChannelId = getPackAnnounceChannel(guildId);
  if (!announceChannelId) return null;

  const announceChannel = guild.channels.cache.get(String(announceChannelId));
  if (!announceChannel) return null;

  const userData       = getUserData(guildId, winner.id);
  const cardCopies     = userData.collection.filter(c => c.nom === card.nom && c.rareté === card.rareté).length;
  const collectionSize = userData.collection.length;
  const typeEmoji      = CARD_TYPES[card.type]?.emoji || '🎴';

  const embed = new EmbedBuilder()
    .setTitle('⚡ ENCOUNTER REMPORTÉ !')
    .setDescription(`# 🎴 ${card.nom}`)
    .setColor(ENCOUNTER_COLOR)
    .addFields(
      { name: `${typeEmoji} Type`,   value: card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : 'Joueur', inline: true },
      { name: '🏆 Rareté',          value: `${getRarityEmoji(card.rareté)} ${card.rareté}`,                                inline: true },
      { name: '📊 Statistiques',    value: formatCardStats(card),                                                           inline: false },
      { name: '🪙 Nouveau solde',   value: `${userData.coins} 🪙`,                                                          inline: true },
      { name: '🎴 Collection',      value: `${collectionSize} carte${collectionSize > 1 ? 's' : ''}`,                       inline: true },
      { name: '📦 Exemplaires',     value: `x${cardCopies}`,                                                                inline: true },
    )
    .setFooter({ text: `Paris Saint-Germain • ${guild.name}`, iconURL: PSG_FOOTER_ICON });

  let cdnImageUrl = null;

  try {
    const attachment = getCardImageAttachment(card);
    const imageUrl   = getCardImageUrlSafe(card);

    if (attachment) {
      embed.setImage(`attachment://${attachment.name}`);
      const sentMsg = await announceChannel.send({ content: `🎉 ${winner}`, embeds: [embed], files: [attachment] });
      setTimeout(() => sentMsg.delete().catch(() => {}), 120_000);
      const att = sentMsg.attachments.first();
      if (att) cdnImageUrl = att.url;
    } else if (imageUrl) {
      embed.setImage(imageUrl);
      const sentMsg = await announceChannel.send({ content: `🎉 ${winner}`, embeds: [embed] });
      setTimeout(() => sentMsg.delete().catch(() => {}), 120_000);
      cdnImageUrl = imageUrl;
    } else {
      const sentMsg = await announceChannel.send({ content: `🎉 ${winner}`, embeds: [embed] });
      setTimeout(() => sentMsg.delete().catch(() => {}), 120_000);
    }
  } catch (e) {
    console.error('❌ Erreur annonce Encounter:', e.message);
  }

  return cdnImageUrl;
}

// ─── Spawn ────────────────────────────────────────────────────────────────────

async function spawnMinigame(client, guildId) {
  const channelId = getMinigameChannel(guildId);
  if (!channelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  if (activeEncounters.has(guildId)) return;

  // ── FIX : lire le timeout depuis la config du serveur ──────────────────────
  const { timeout_s } = getEncounterConfig(guildId);
  const timeoutSeconds = timeout_s ?? MINIGAME_CONFIG.timeout;

  const cards  = loadEncounterCards();
  const labels = ['A', 'B', 'C', 'D'];

  if (cards.length) {
    // ── Mode normal (pack_encounter.json présent) ─────────────────────────
    const card         = cards[Math.floor(Math.random() * cards.length)];
    const questionData = card.questions[Math.floor(Math.random() * card.questions.length)];

    const embed = new EmbedBuilder()
      .setTitle('⚡ PSG ENCOUNTER !')
      .setDescription(
        `Un joueur du PSG vient d'apparaître !\n`
        + `Réponds correctement **en premier** pour remporter sa carte exclusive !\n\n`
        + `━━━━━━━━━━━━━━━━━━━━━━\n`
        + `❓ **${questionData.question}**\n`
        + `━━━━━━━━━━━━━━━━━━━━━━`,
      )
      .setColor(ENCOUNTER_COLOR)
      .addFields(
        { name: '⏱️ Temps limite', value: `${timeoutSeconds} secondes`,                                                   inline: true },
        { name: '🏆 Récompense',   value: `Carte **${card.nom}** — ${getRarityEmoji(card.rareté)} ${card.rareté}`,       inline: true },
      )
      .setFooter({ text: 'Première bonne réponse gagne ! • Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    const attachment = getCardImageAttachment(card);
    const imageUrl   = getCardImageUrlSafe(card);
    if (attachment) embed.setImage(`attachment://${attachment.name}`);
    else if (imageUrl) embed.setImage(imageUrl);

    const validAnswers = questionData.answers
      .map((a, i) => ({ answer: a, index: i }))
      .filter(a => a.answer !== '—');

    const buttons = validAnswers.map(({ answer, index }) =>
      new ButtonBuilder()
        .setCustomId(`encounter_answer_${guildId}_${index}`)
        .setLabel(`${labels[index]}. ${answer}`)
        .setStyle(ButtonStyle.Primary),
    );

    const sendOptions = { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
    if (attachment) sendOptions.files = [attachment];

    let message;
    try {
      message = await channel.send(sendOptions);
    } catch (e) {
      console.error(`❌ Erreur envoi Encounter pour ${guild.name}:`, e.message);
      scheduleNextMinigame(guildId);
      return;
    }

    activeEncounters.set(guildId, {
      mode: 'encounter', answered: new Set(), winner: null,
      card, questionData, validAnswers, message, guildId, client,
    });

    // ── FIX : utiliser timeoutSeconds (config serveur) ─────────────────────
    const timeout = setTimeout(() => _handleEncounterTimeout(guildId, validAnswers, labels), timeoutSeconds * 1000);
    activeEncounters.get(guildId).timeout = timeout;
    console.log(`⚡ Encounter spawné sur ${guild.name} : ${card.nom} (timeout: ${timeoutSeconds}s)`);

  } else {
    // ── Mode fallback (pas de pack_encounter.json) ────────────────────────
    const questionData = PSG_QUESTIONS_FALLBACK[Math.floor(Math.random() * PSG_QUESTIONS_FALLBACK.length)];

    const embed = new EmbedBuilder()
      .setTitle('⚡ PSG ENCOUNTER !')
      .setDescription(
        `Un joueur du PSG vient d'apparaître ! Réponds correctement et rapidement pour gagner une carte exclusive !\n\n`
        + `━━━━━━━━━━━━━━━━━━━━━━\n`
        + `❓ **${questionData.question}**\n`
        + `━━━━━━━━━━━━━━━━━━━━━━`,
      )
      .setColor(ENCOUNTER_COLOR)
      .addFields(
        { name: '⏱️ Temps limite', value: `${timeoutSeconds} secondes`, inline: true },
        { name: '🏆 Récompense',   value: 'Carte Légendaire/Épique',    inline: true },
      )
      .setFooter({ text: 'Première bonne réponse gagne ! • Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    const buttons = questionData.answers.map((answer, i) =>
      new ButtonBuilder()
        .setCustomId(`encounter_answer_${guildId}_${i}`)
        .setLabel(`${labels[i]}. ${answer}`)
        .setStyle(ButtonStyle.Primary),
    );

    let message;
    try {
      message = await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] });
    } catch (e) {
      console.error(`❌ Erreur envoi mini-jeu pour ${guild.name}:`, e.message);
      scheduleNextMinigame(guildId);
      return;
    }

    const validAnswers = questionData.answers.map((a, i) => ({ answer: a, index: i }));
    activeEncounters.set(guildId, {
      mode: 'fallback', answered: new Set(), winner: null,
      card: null, questionData, validAnswers, message, guildId, client,
    });

    // ── FIX : utiliser timeoutSeconds (config serveur) ─────────────────────
    const timeout = setTimeout(() => _handleEncounterTimeout(guildId, validAnswers, labels), timeoutSeconds * 1000);
    activeEncounters.get(guildId).timeout = timeout;
    console.log(`⚡ Encounter (fallback) spawné sur ${guild.name} (timeout: ${timeoutSeconds}s)`);
  }
}

// ─── Timeout ──────────────────────────────────────────────────────────────────

async function _handleEncounterTimeout(guildId, validAnswers, labels) {
  const state = activeEncounters.get(guildId);
  if (!state || state.winner) return;

  const { message } = state;

  const disabledButtons = validAnswers.map(({ answer, index }) =>
    new ButtonBuilder()
      .setCustomId(`encounter_answer_${guildId}_${index}`)
      .setLabel(`${labels[index]}. ${answer}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );

  const timeoutEmbed = new EmbedBuilder()
    .setTitle('⏰ Encounter expiré !')
    .setDescription(
      `Personne n'a répondu correctement à temps...\n\n`
      + (state.card ? `La carte **${state.card.nom}** repart dans la nature ! 🃏` : ''),
    )
    .setColor(ENCOUNTER_COLOR)
    .setFooter({ text: 'Paris Saint-Germain • PSG Encounter', iconURL: PSG_FOOTER_ICON });

  try { await message.edit({ embeds: [timeoutEmbed], components: [new ActionRowBuilder().addComponents(disabledButtons)] }); } catch { /* supprimé */ }

  setTimeout(async () => { try { await message.delete(); } catch { /* déjà supprimé */ } }, 10000);

  activeEncounters.delete(guildId);
  scheduleNextMinigame(guildId);
}

// ─── Réponse d'un joueur ──────────────────────────────────────────────────────

async function handleMinigameAnswer(interaction) {
  const parts       = interaction.customId.split('_');
  const guildId     = parts[2];
  const answerIndex = parseInt(parts[3], 10);

  const state = activeEncounters.get(guildId);
  if (!state) {
    return interaction.reply({ content: '❌ Cet encounter est déjà terminé.', flags: MessageFlags.Ephemeral });
  }
  if (state.answered.has(interaction.user.id)) {
    return interaction.reply({ content: '❌ Tu as déjà répondu à cet encounter !', flags: MessageFlags.Ephemeral });
  }
  state.answered.add(interaction.user.id);

  const { card, questionData, validAnswers, message } = state;
  const labels = ['A', 'B', 'C', 'D'];

  if (answerIndex !== questionData.correct) {
    return interaction.reply({
      content: `❌ Mauvaise réponse ! Dommage... ${card ? `La carte **${card.nom}** est encore à prendre !` : ''}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Bonne réponse ──────────────────────────────────────────────────────────
  if (state.winner) {
    return interaction.reply({
      content: `✅ Bonne réponse ! Mais **${state.winner.displayName || state.winner.username}** a été plus rapide... 😔`,
      flags: MessageFlags.Ephemeral,
    });
  }

  state.winner = interaction.user;
  clearTimeout(state.timeout);

  const disabledButtons = validAnswers.map(({ answer, index }) =>
    new ButtonBuilder()
      .setCustomId(`encounter_answer_${guildId}_${index}`)
      .setLabel(`${labels[index]}. ${answer}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );

  try { await interaction.update({ components: [new ActionRowBuilder().addComponents(disabledButtons)] }); } catch { /* ok */ }

  if (card) {
    addCardToUser(guildId, interaction.user.id, card);
    logMinigameWin(interaction, card, guildId).catch(() => {});

    const cdnImageUrl = await announceEncounterWin(interaction.guild, interaction.user, card, guildId);

    const userData       = getUserData(guildId, interaction.user.id);
    const cardCopies     = userData.collection.filter(c => c.nom === card.nom && c.rareté === card.rareté).length;
    const collectionSize = userData.collection.length;
    const typeEmoji      = CARD_TYPES[card.type]?.emoji || '🎴';

    const winEmbed = new EmbedBuilder()
      .setTitle('🎉 Tu as remporté l\'Encounter !')
      .setDescription(`# 🎴 ${card.nom}`)
      .setColor(ENCOUNTER_COLOR)
      .addFields(
        { name: `${typeEmoji} Type`,  value: card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : 'Joueur', inline: true },
        { name: '🏆 Rareté',         value: `${getRarityEmoji(card.rareté)} ${card.rareté}`,                                inline: true },
        { name: '📊 Statistiques',   value: formatCardStats(card),                                                           inline: false },
        { name: '🪙 Nouveau solde',  value: `${userData.coins} 🪙`,                                                          inline: true },
        { name: '🎴 Collection',     value: `${collectionSize} carte${collectionSize > 1 ? 's' : ''}`,                       inline: true },
        { name: '📦 Exemplaires',    value: `x${cardCopies}`,                                                                inline: true },
      )
      .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

    if (cdnImageUrl) winEmbed.setImage(cdnImageUrl);

    setTimeout(async () => { try { await message.delete(); } catch { /* ok */ } }, 2000);

    try {
      await interaction.followUp({ embeds: [winEmbed], flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error('❌ Erreur envoi embed victoire:', e.message);
    }

  } else {
    await _giveFallbackReward(interaction, guildId, message);
  }

  activeEncounters.delete(guildId);
  scheduleNextMinigame(guildId);
}

// ─── Récompense fallback ──────────────────────────────────────────────────────

async function _giveFallbackReward(interaction, guildId, message) {
  const cards = loadPackCards('pack_event');
  if (!cards.length) {
    await interaction.followUp({ content: '❌ Erreur : Aucune carte disponible dans le pack événement.', flags: MessageFlags.Ephemeral });
    return;
  }

  const chosenRarity  = weightedRandom(PACKS_CONFIG.pack_event.drop_rates);
  const cardsOfRarity = cards.filter(c => c.rareté === chosenRarity);
  const card          = cardsOfRarity.length
    ? cardsOfRarity[Math.floor(Math.random() * cardsOfRarity.length)]
    : cards[Math.floor(Math.random() * cards.length)];

  addCardToUser(guildId, interaction.user.id, card);
  logMinigameWin(interaction, card, guildId).catch(() => {});

  const cdnImageUrl = await announceEncounterWin(interaction.guild, interaction.user, card, guildId);

  const userData       = getUserData(guildId, interaction.user.id);
  const cardCopies     = userData.collection.filter(c => c.nom === card.nom && c.rareté === card.rareté).length;
  const collectionSize = userData.collection.length;
  const typeEmoji      = CARD_TYPES[card.type]?.emoji || '🎴';

  const embed = new EmbedBuilder()
    .setTitle('🎉 Tu as remporté l\'Encounter !')
    .setDescription(`# 🎴 ${card.nom}`)
    .setColor(ENCOUNTER_COLOR)
    .addFields(
      { name: `${typeEmoji} Type`,  value: card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : 'Joueur', inline: true },
      { name: '🏆 Rareté',         value: `${getRarityEmoji(card.rareté)} ${card.rareté}`,                                inline: true },
      { name: '📊 Statistiques',   value: formatCardStats(card),                                                           inline: false },
      { name: '🪙 Nouveau solde',  value: `${userData.coins} 🪙`,                                                          inline: true },
      { name: '🎴 Collection',     value: `${collectionSize} carte${collectionSize > 1 ? 's' : ''}`,                       inline: true },
      { name: '📦 Exemplaires',    value: `x${cardCopies}`,                                                                inline: true },
    )
    .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

  if (cdnImageUrl) embed.setImage(cdnImageUrl);

  const endEmbed = new EmbedBuilder()
    .setTitle('🎉 GAGNANT !')
    .setDescription(`**${interaction.user} a capturé le joueur Encounter !**`)
    .setColor(ENCOUNTER_COLOR);

  try { await message.edit({ embeds: [endEmbed], components: [] }); } catch { /* ok */ }
  await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── Commande /minigame config ────────────────────────────────────────────────

async function configMinigameCommand(interaction, salon) {
  if (!checkRolePermission(interaction, 'admin')) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Accès refusé')
        .setDescription('Seuls les administrateurs peuvent utiliser cette commande.')
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  setMinigameChannel(guildId, salon.id);
  const nextTime = getNextMinigameTime(guildId);

  // ── FIX : lire interval_min_ms / interval_max_ms au lieu de l'ancien interval_ms ──
  const { interval_min_ms, interval_max_ms, start_hour, end_hour, timeout_s } = getEncounterConfig(guildId);

  const intervalDisplay = interval_min_ms === interval_max_ms
    ? `**${formatIntervalMs(interval_min_ms)}**`
    : `entre **${formatIntervalMs(interval_min_ms)}** et **${formatIntervalMs(interval_max_ms)}**`;

  const embed = new EmbedBuilder()
    .setTitle('✅ Encounter configuré')
    .setDescription(`Le PSG Encounter apparaîtra dans ${salon}`)
    .setColor(PSG_BLUE)
    .addFields(
      {
        name:   '⏰ Prochaine apparition',
        value:  `<t:${Math.floor(nextTime.getTime() / 1000)}:F>\n(<t:${Math.floor(nextTime.getTime() / 1000)}:R>)`,
        inline: false,
      },
      {
        name:   '📅 Intervalle',
        value:  `${intervalDisplay} après chaque Encounter`,
        inline: true,
      },
      {
        name:   '🕐 Fourchette horaire',
        value:  `Entre ${String(start_hour).padStart(2, '0')}h00 et ${String(end_hour).padStart(2, '0')}h00`,
        inline: true,
      },
      {
        name:   '⏱️ Timeout question',
        value:  `${timeout_s ?? MINIGAME_CONFIG.timeout} secondes`,
        inline: true,
      },
    )
    .setFooter({ text: 'Paris Saint-Germain • Système Encounter', iconURL: PSG_FOOTER_ICON });

  return interaction.reply({ embeds: [embed] });
}

module.exports = { spawnMinigame, handleMinigameAnswer, configMinigameCommand, activeEncounters };