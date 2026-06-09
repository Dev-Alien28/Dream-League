console.log('✅ gaming_room.js VERSION NOUVELLE chargé');
// src/commands/gaming_room.js - Embed permanent PSG Dream League
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const {
  getUserData, saveUserData, loadPackCards,
  canClaimFreePack, claimFreePack, getFreePackCooldown,
  getUserCardsGrouped, getPackAnnounceChannel,
  recordPackPurchase, recordFailedPurchase,
} = require('../utils/database');
const { PSG_BLUE, PSG_RED, PACKS_CONFIG, CARD_TYPES, PSG_FOOTER_ICON } = require('../config/settings');
const {
  getRarityColor, getRarityEmoji, getRarityCardImage,
  formatCardStats, weightedRandom,
  formatCardName, formatArtistCredit,
} = require('../utils/cardHelpers');
const { logPackPurchase } = require('../utils/logs');
const fs   = require('fs');
const path = require('path');

// ─── Fallback unicode PAR ID d'emoji custom ────────────────────────────────────
const EMOJI_ID_FALLBACK = {
  '1511106840681910343': '⭐',
  '1511106619922976958': '🌟',
};

const PACK_EMOJI_FALLBACK = {
  psg_start:    '🔴',
  psg_11_03:    '🪄',
  Back_to_Back: '🌟',
  starter_pack: '🎖️',
  free_pack:    '🎁',
  pack_event:   '✨',
};

// ─── Convertit TOUS les emojis custom d'une chaîne en unicode ──────────────────
function toPlainText(str, packKey) {
  return str.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
    return EMOJI_ID_FALLBACK[id] || PACK_EMOJI_FALLBACK[packKey] || '⭐';
  }).trim();
}

// ─── Résout l'emoji principal d'un pack ────────────────────────────────────────
function resolvePackEmoji(rawEmoji, packKey, guild) {
  const fallback = EMOJI_ID_FALLBACK[rawEmoji.match(/\d+/)?.[0]] || PACK_EMOJI_FALLBACK[packKey] || '🎴';

  if (!rawEmoji.startsWith('<')) {
    return { emojiString: rawEmoji, emojiObject: null };
  }

  const match = rawEmoji.match(/^<a?:(\w+):(\d+)>$/);
  if (!match) return { emojiString: fallback, emojiObject: null };

  const [, emojiName, emojiId] = match;
  const found = guild.emojis.cache.get(emojiId);

  if (found) {
    return { emojiString: rawEmoji, emojiObject: { name: emojiName, id: emojiId } };
  }

  console.warn(`⚠️ Emoji <:${emojiName}:${emojiId}> absent sur "${guild.name}" → fallback "${fallback}"`);
  return { emojiString: fallback, emojiObject: null };
}

// ─── Résout les emojis custom dans un NOM pour les embeds ─────────────────────
function resolveNomForEmbed(nom, packKey, guild) {
  return nom.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
    if (guild.emojis.cache.get(id)) return match;
    const fallback = EMOJI_ID_FALLBACK[id] || PACK_EMOJI_FALLBACK[packKey] || '⭐';
    console.warn(`⚠️ Emoji <:${name}:${id}> absent sur "${guild.name}" → fallback "${fallback}"`);
    return fallback;
  });
}

// ─── Wrapper sécurisé pour toutes les interactions ─────────────────────────────
async function safeInteraction(interaction, fn, { defer = true, ephemeral = true } = {}) {
  try {
    if (defer && !interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    }
  } catch {
    return;
  }
  try {
    await fn();
  } catch (err) {
    console.error('❌ Erreur interaction :', err);
    const msg = { content: '❌ Une erreur est survenue, réessaie dans quelques secondes.' };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
    } catch { /* interaction expirée */ }
  }
}

// ─── Lock anti-double-achat ────────────────────────────────────────────────────
const buyTimestamps = new Map();
const BUY_LOCK_WINDOW_MS = 5000;

function canBuy(lockKey) {
  const now  = Date.now();
  const last = buyTimestamps.get(lockKey) || 0;
  if (now - last < BUY_LOCK_WINDOW_MS) return false;
  buyTimestamps.set(lockKey, now);
  return true;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function pluralCartes(n) { return `${n} carte${n > 1 ? 's' : ''}`; }

function getCardImageFile(card) {
  const imagePath = card.image || '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return null;
  const absolutePath = path.join(__dirname, '..', imagePath);
  if (imagePath && fs.existsSync(absolutePath)) {
    try { return new AttachmentBuilder(absolutePath, { name: path.basename(absolutePath) }); }
    catch { return null; }
  }
  return null;
}

function getCardImageUrlLocal(card) {
  const imagePath = card.image || '';
  if (imagePath && (imagePath.startsWith('http://') || imagePath.startsWith('https://'))) {
    if (imagePath.length <= 2048) return imagePath;
  }
  return null;
}

// ─── Vérifie si l'utilisateur a déjà réclamé le starter pack ─────────────────
function hasClaimedStarterPack(guildId, userId) {
  const userData = getUserData(guildId, userId);
  return userData.starterClaimed === true;
}

// ─── Délai de suppression des annonces publiques (2 minutes) ─────────────────
const ANNOUNCE_DELETE_DELAY_MS = 120_000;

// ─── EMBED PRINCIPAL GAMING ROOM ──────────────────────────────────────────────
async function sendGamingRoomEmbed(channel) {
  const boitePath = path.join(__dirname, '..', 'images', 'Boite.png');
  const hasImage  = fs.existsSync(boitePath);

  const embed = new EmbedBuilder()
    .setTitle('Gaming Room 🕹️')
    .setDescription(
      '***🪙 Obtenez des PSG Coins en discutant dans les différents chats écrits !***\n\n'
      + '***Clique sur un bouton ci-dessous !***\n\n'
      + '🎴 **Boutique PSG Dream League**\n'
      + 'Retrouvez tous les boosters de cartes afin de composer votre équipe de rêve !\n\n'
      + '🗂️ **Collection**\n'
      + 'Observez votre collection complète de cartes et consultez votre solde de PSG Coins\n\n'
      + '──────────────────────────\n'
      + '💬 **Venez discuter de PSG Dream League dans <#1326910792146354318> !**',
    )
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  if (hasImage) embed.setImage('attachment://Boite.png');

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('gr_boosters').setLabel('🎴 Les Boosters').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('gr_collection').setLabel('🗂️ La Collection').setStyle(ButtonStyle.Primary),
    ),
  ];

  if (hasImage) {
    const file = new AttachmentBuilder(boitePath, { name: 'Boite.png' });
    return channel.send({ embeds: [embed], components, files: [file] });
  }
  return channel.send({ embeds: [embed], components });
}

// ─── BOUTON : LES BOOSTERS ────────────────────────────────────────────────────
async function handleBoosters(interaction) {
  return safeInteraction(interaction, async () => {
    const guildId  = interaction.guildId;
    const userId   = interaction.user.id;
    const userData = getUserData(guildId, userId);
    const guild    = interaction.guild;

    await guild.emojis.fetch().catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('🎁 BOUTIQUE PSG - PACKS DISPONIBLES')
      .setDescription('Clique sur un bouton ci-dessous pour acheter un pack !\nChaque pack contient **1 carte exclusive** avec des taux de drop différents.\n\u200b')
      .setColor(PSG_BLUE)
      .setFooter({
        text: `Ton solde : ${userData.coins} PSG Coins • ${guild.name} • Expire dans 1 min`,
        iconURL: PSG_FOOTER_ICON,
      });

    const packEntries = Object.entries(PACKS_CONFIG).filter(([k, p]) => k !== 'pack_event' && !p.hidden);

    for (let i = 0; i < packEntries.length; i++) {
      const [packKey, packInfo] = packEntries[i];
      const { emojiString }     = resolvePackEmoji(packInfo.emoji, packKey, guild);
      const nomEmbed            = resolveNomForEmbed(packInfo.nom, packKey, guild);

      let extraInfo = '';

      if (packKey === 'starter_pack') {
        if (hasClaimedStarterPack(guildId, userId)) {
          extraInfo = '\n✅ **Déjà réclamé !**';
        } else {
          extraInfo = '\n🎁 **Disponible — Une seule fois !**';
        }
      } else if (packKey === 'free_pack') {
        if (canClaimFreePack(guildId, userId)) {
          extraInfo = '\n✅ **Disponible maintenant !**';
        } else {
          const cooldown = getFreePackCooldown(guildId, userId);
          const hours    = Math.floor(cooldown / 3600);
          const minutes  = Math.floor((cooldown % 3600) / 60);
          extraInfo = `\n⏰ Disponible dans **${hours}h${String(minutes).padStart(2, '0')}m**`;
        }
      }

      embed.addFields({
        name:   `${emojiString} **${nomEmbed}**`,
        value:  `${packInfo.description}${extraInfo}${i < packEntries.length - 1 ? '\n\u200b' : ''}`,
        inline: false,
      });
    }

    const rows = [];
    let row = new ActionRowBuilder();
    let btnCount = 0;

    for (const [packKey, packInfo] of packEntries) {
      if (btnCount === 5) { rows.push(row); row = new ActionRowBuilder(); btnCount = 0; }

      const { emojiObject } = resolvePackEmoji(packInfo.emoji, packKey, guild);
      const nomPlain        = toPlainText(packInfo.nom, packKey);
      const labelPrefix     = emojiObject ? '' : toPlainText(packInfo.emoji, packKey) + ' ';

      // ── Logique de style et label par type de pack ──────────────────────────
      let style;
      let label;

      if (packKey === 'starter_pack') {
        style = ButtonStyle.Danger;
        if (hasClaimedStarterPack(guildId, userId)) {
          label = `${labelPrefix}${nomPlain} — Déjà réclamé`.slice(0, 80);
        } else {
          label = `${labelPrefix}${nomPlain} — GRATUIT`.slice(0, 80);
        }
      } else if (packKey === 'free_pack') {
        style = ButtonStyle.Success;
        label = `${labelPrefix}${nomPlain} - ${packInfo.prix} 🪙`.slice(0, 80);
      } else {
        style = ButtonStyle.Primary;
        label = `${labelPrefix}${nomPlain} - ${packInfo.prix} 🪙`.slice(0, 80);
      }

      const btn = new ButtonBuilder()
        .setCustomId(`gr_buy_pack_${packKey}_${userId}`)
        .setLabel(label)
        .setStyle(style);

      if (emojiObject) btn.setEmoji({ name: emojiObject.name, id: emojiObject.id });

      row.addComponents(btn);
      btnCount++;
    }
    if (btnCount > 0) rows.push(row);

    embed.setImage('https://i.imgur.com/UeU5B40.png');
    await interaction.editReply({ embeds: [embed], components: rows });

    setTimeout(async () => {
      try {
        const disabledRows = rows.map(r => {
          const newRow = new ActionRowBuilder();
          newRow.addComponents(r.components.map(btn => ButtonBuilder.from(btn.toJSON()).setDisabled(true)));
          return newRow;
        });
        await interaction.editReply({ components: disabledRows });
      } catch { /* message supprimé ou interaction expirée */ }
    }, 60000);
  });
}

// ─── BOUTON : ACHAT PACK ──────────────────────────────────────────────────────
async function handleBuyPack(interaction, packKey) {
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const lockKey = `${guildId}:${userId}`;

  if (!canBuy(lockKey)) {
    try { await interaction.deferUpdate(); } catch { /* ok */ }
    return;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    buyTimestamps.set(lockKey, 0);
    console.error(`⚠️ deferReply échoué pour achat pack (${packKey}):`, err.message);
    return;
  }

  try {
    const packInfo = PACKS_CONFIG[packKey];
    if (!packInfo) return interaction.editReply({ content: '❌ Pack inconnu.' });

    const userData = getUserData(guildId, userId);

    // ── CAS STARTER PACK (one-shot, toutes les cartes d'un coup) ─────────────
    if (packKey === 'starter_pack') {
      if (hasClaimedStarterPack(guildId, userId)) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Pack Starter déjà réclamé')
            .setDescription("Tu as déjà récupéré ton Pack Starter !\nCe pack n'est disponible **qu'une seule fois** par joueur.")
            .setColor(PSG_RED)
            .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
        });
      }

      const allStarterCards = loadPackCards('starter_pack');
      if (!allStarterCards.length) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Erreur')
            .setDescription('Aucune carte disponible dans ce pack.')
            .setColor(PSG_RED)],
        });
      }

      const freshData = getUserData(guildId, userId);
      freshData.starterClaimed = true;
      freshData.collection.push(...allStarterCards);
      saveUserData(guildId, userId, freshData);

      try {
        recordPackPurchase(guildId, userId, 'starter_pack', 0, `${allStarterCards.length} cartes Basic`, 'Basic');
      } catch (e) { console.error('⚠️ recordPackPurchase starter error:', e.message); }

      // ── Groupement par position pour l'affichage ──────────────────────────
      const byPosition = {};
      for (const c of allStarterCards) {
        if (!byPosition[c.position]) byPosition[c.position] = [];
        byPosition[c.position].push(c.nom.replace(' Starter', ''));
      }
      const positionOrder  = ['Gardien', 'Défenseur', 'Milieu', 'Attaquant'];
      const positionEmoji  = { Gardien: '🧤', Défenseur: '🛡️', Milieu: '⚙️', Attaquant: '⚽' };
      const positionPlural = { Gardien: 'Gardiens', Défenseur: 'Défenseurs', Milieu: 'Milieux', Attaquant: 'Attaquants' };

      const groupedLines = positionOrder
        .filter(pos => byPosition[pos])
        .map(pos => `${positionEmoji[pos]} **${positionPlural[pos]}** : ${byPosition[pos].join(', ')}`)
        .join('\n');

      // Annonce publique si canal configuré
      const announceChannelId = getPackAnnounceChannel(guildId);
      if (announceChannelId) {
        const announceChannel = interaction.guild.channels.cache.get(String(announceChannelId));
        if (announceChannel) {
          const publicEmbed = new EmbedBuilder()
            .setTitle('🎖️ Pack Starter réclamé !')
            .setDescription(
              `🎉 ${interaction.user} vient de récupérer son **Pack Starter** !\n\n`
              + `${groupedLines}\n\n`
              + `⚪ **Stats** : 60 partout — ${allStarterCards.length} cartes ajoutées !`,
            )
            .setColor(0x8B5E3C)
            .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });
          // ── Suppression 2 min après ───────────────────────────────────────
          announceChannel.send({ embeds: [publicEmbed] })
            .then(sentMsg => setTimeout(() => sentMsg.delete().catch(() => {}), ANNOUNCE_DELETE_DELAY_MS))
            .catch(() => {});
        }
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('🎖️ Pack Starter réclamé !')
          .setDescription(
            `Tu as reçu **${allStarterCards.length} cartes** !\n\n`
            + `${groupedLines}\n\n`
            + `⚪ **Stats communes** : 60 / 60 / 60\n`
            + `🪙 Solde actuel : **${freshData.coins} PSG Coins**`,
          )
          .setColor(0x8B5E3C)
          .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
      });
    }

    // ── CAS FREE PACK ─────────────────────────────────────────────────────────
    if (packKey === 'free_pack') {
      if (!canClaimFreePack(guildId, userId)) {
        const cooldown = getFreePackCooldown(guildId, userId);
        const hours    = Math.floor(cooldown / 3600);
        const minutes  = Math.floor((cooldown % 3600) / 60);
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('⏰ Pack gratuit indisponible')
            .setDescription(`Tu as déjà réclamé ton pack gratuit !\n\n**Prochain pack dans :** ${hours}h ${minutes}m`)
            .setColor(PSG_RED)
            .setFooter({ text: 'Le pack gratuit se recharge toutes les 24 heures' })],
        });
      }
      claimFreePack(guildId, userId);

    // ── CAS PACK PAYANT ───────────────────────────────────────────────────────
    } else if (userData.coins < packInfo.prix) {
      try { recordFailedPurchase(guildId, userId, packKey, packInfo.prix, userData.coins); }
      catch (e) { console.error('⚠️ recordFailedPurchase error:', e.message); }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Solde insuffisant')
          .setDescription("Tu n'as pas assez de PSG Coins pour acheter ce pack !")
          .setColor(PSG_RED)
          .addFields(
            { name: '💰 Prix du pack', value: `${packInfo.prix} 🪙`,                 inline: true },
            { name: '💎 Ton solde',    value: `${userData.coins} 🪙`,                inline: true },
            { name: '❗ Il te manque', value: `${packInfo.prix - userData.coins} 🪙`, inline: true },
          )
          .setFooter({ text: 'Parlez dans le chat pour gagner des PSG Coins !' })],
      });
    }

    // ── TIRAGE CARTE (free pack ou pack payant) ───────────────────────────────
    const allCards = loadPackCards(packKey);
    if (!allCards.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('Aucune carte disponible dans ce pack.')
          .setColor(PSG_RED)],
      });
    }

    const chosenRarity  = weightedRandom(packInfo.drop_rates);
    const cardsOfRarity = allCards.filter(c => c.rareté === chosenRarity);
    const card = cardsOfRarity.length
      ? cardsOfRarity[Math.floor(Math.random() * cardsOfRarity.length)]
      : allCards[Math.floor(Math.random() * allCards.length)];

    const freshData = getUserData(guildId, userId);
    if (packKey !== 'free_pack') freshData.coins -= packInfo.prix;
    freshData.collection.push(card);
    saveUserData(guildId, userId, freshData);

    try {
      recordPackPurchase(guildId, userId, packKey, packKey === 'free_pack' ? 0 : packInfo.prix, card.nom || '', card.rareté || '');
    } catch (e) { console.error('⚠️ recordPackPurchase error:', e.message); }

    logPackPurchase(interaction, packInfo, card, freshData.coins).catch(() => {});

    const typeEmoji      = CARD_TYPES[card.type]?.emoji || '🎴';
    const collectionSize = freshData.collection.length;
    const cardCopies     = freshData.collection.filter(c => c.nom === card.nom && c.rareté === card.rareté).length;
    const artistCredit   = formatArtistCredit(card);

    await interaction.guild.emojis.fetch().catch(() => {});
    const { emojiString: packEmojiStr } = resolvePackEmoji(packInfo.emoji, packKey, interaction.guild);
    const packNomEmbed                  = resolveNomForEmbed(packInfo.nom, packKey, interaction.guild);

    function buildCardEmbed() {
      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${packEmojiStr} ${packNomEmbed} ouvert !`)
        .setDescription(`# 🎴 ${formatCardName(card)}`)
        .setColor(getRarityColor(card.rareté))
        .addFields(
          { name: `${typeEmoji} Type`,   value: card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : 'Joueur', inline: true },
          { name: '🏆 Rareté',           value: `${getRarityEmoji(card.rareté)} ${card.rareté}`, inline: true },
          { name: '📊 Statistiques',     value: formatCardStats(card), inline: false },
          { name: '🪙 Nouveau solde',    value: `${freshData.coins} 🪙`, inline: true },
          { name: '🎴 Collection',       value: pluralCartes(collectionSize), inline: true },
          { name: '📦 Exemplaires',      value: `x${cardCopies}`, inline: true },
        )
        .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

      if (artistCredit) embed.addFields({ name: '\u200b', value: artistCredit, inline: false });

      return embed;
    }

    const imageFile    = getCardImageFile(card);
    const cardImageUrl = getCardImageUrlLocal(card);
    let cdnImageUrl    = cardImageUrl || null;

    const announceChannelId = getPackAnnounceChannel(guildId);
    if (announceChannelId) {
      const announceChannel = interaction.guild.channels.cache.get(String(announceChannelId));
      if (announceChannel) {
        const publicEmbed = buildCardEmbed();
        try {
          if (imageFile) {
            const announceFile = getCardImageFile(card);
            publicEmbed.setImage(`attachment://${announceFile.name}`);
            const sentMsg    = await announceChannel.send({ content: `🎉 ${interaction.user}`, embeds: [publicEmbed], files: [announceFile] });
            // ── Suppression 2 min après ───────────────────────────────────
            setTimeout(() => sentMsg.delete().catch(() => {}), ANNOUNCE_DELETE_DELAY_MS);
            const attachment = sentMsg.attachments.first();
            if (attachment) cdnImageUrl = attachment.url;
          } else if (cardImageUrl) {
            publicEmbed.setImage(cardImageUrl);
            const sentMsg = await announceChannel.send({ content: `🎉 ${interaction.user}`, embeds: [publicEmbed] });
            // ── Suppression 2 min après ───────────────────────────────────
            setTimeout(() => sentMsg.delete().catch(() => {}), ANNOUNCE_DELETE_DELAY_MS);
          } else {
            const sentMsg = await announceChannel.send({ content: `🎉 ${interaction.user}`, embeds: [publicEmbed] });
            // ── Suppression 2 min après ───────────────────────────────────
            setTimeout(() => sentMsg.delete().catch(() => {}), ANNOUNCE_DELETE_DELAY_MS);
          }
        } catch { /* bot sans accès au salon */ }
      }
    }

    const ephemeralEmbed = buildCardEmbed();
    if (cdnImageUrl) {
      ephemeralEmbed.setImage(cdnImageUrl);
      await interaction.editReply({ embeds: [ephemeralEmbed] });
    } else if (imageFile) {
      const ephemeralFile = getCardImageFile(card);
      ephemeralEmbed.setImage(`attachment://${ephemeralFile.name}`);
      await interaction.editReply({ embeds: [ephemeralEmbed], files: [ephemeralFile] });
    } else {
      await interaction.editReply({ embeds: [ephemeralEmbed] });
    }

  } catch (err) {
    console.error(`❌ Erreur handleBuyPack (${packKey}):`, err);
    try { await interaction.editReply({ content: "❌ Une erreur est survenue lors de l'ouverture du pack." }); } catch { /* ok */ }
  }
}

// ─── BOUTON : LA COLLECTION → UserSelectMenu ───────────────────────────────────
async function handleCollection(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('🗂️ Collection')
      .setDescription('Sélectionne un membre pour voir sa collection, ou clique sur **Ma collection** pour voir la tienne !')
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

    const avatarUrl = interaction.user.displayAvatarURL();
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    const row = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`gr_coll_user_select_${interaction.user.id}`)
        .setPlaceholder("👤 Voir la collection d'un membre...")
        .setMinValues(1)
        .setMaxValues(1),
    );

    const myCollectionBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gr_coll_self_${interaction.user.id}`)
        .setLabel('📋 Ma collection')
        .setStyle(ButtonStyle.Primary),
    );

    return await interaction.reply({
      embeds:     [embed],
      components: [row, myCollectionBtn],
      flags:      MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error('❌ Erreur handleCollection :', err);
    try {
      const msg = { content: '❌ Une erreur est survenue, réessaie dans quelques secondes.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply(msg);
    } catch { /* interaction expirée */ }
  }
}

// ─── COLLECTION : afficher pour un userId donné ────────────────────────────────
async function showCollection(interaction, targetUserId, targetUserName) {
  const guildId      = interaction.guildId;
  const viewerId     = interaction.user.id;
  const cardsGrouped = getUserCardsGrouped(guildId, targetUserId);

  const emptyEmbed = new EmbedBuilder()
    .setTitle(`📋 Collection de ${targetUserName}`)
    .setDescription('🔭 Cette collection est vide!\n\nAchète des packs pour commencer ta collection!')
    .setColor(PSG_BLUE)
    .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

  if (!Object.keys(cardsGrouped).length) {
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isButton()) {
      return interaction.update({ embeds: [emptyEmbed], components: [] });
    }
    return interaction.reply({ embeds: [emptyEmbed], flags: MessageFlags.Ephemeral });
  }

  const pages          = organizeCardsByRarity(cardsGrouped);
  const totalUnique    = Object.keys(cardsGrouped).length;
  const totalCards     = Object.values(cardsGrouped).reduce((s, d) => s + d.count, 0);
  const targetUserData = getUserData(guildId, targetUserId);

  collectionSessions.set(viewerId, {
    guildId,
    userId:       targetUserId,
    userName:     targetUserName,
    cardsGrouped,
    pages,
    currentPage:  0,
    totalUnique,
    totalCards,
    targetCoins:  targetUserData.coins,
    isSelf:       targetUserId === viewerId,
    expireAt:     Date.now() + 15 * 60 * 1000,
  });

  const embedPage  = createCollectionEmbed(targetUserName, pages[0], 1, pages.length, totalUnique, totalCards, targetUserData.coins, targetUserId === viewerId);
  const components = buildCollectionComponents(pages, 0, pages.length, cardsGrouped, viewerId);

  if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isButton()) {
    return interaction.update({ embeds: [embedPage], components });
  }
  return interaction.reply({ embeds: [embedPage], components, flags: MessageFlags.Ephemeral });
}

// ─── COLLECTION : données ──────────────────────────────────────────────────────
const RARITY_ORDER  = { Give: -1, Encounter: 0, Legend: 1, Unique: 2, Elite: 3, Advanced: 4, Basic: 5 };
const CARDS_PER_PAGE = 10;
const collectionSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of collectionSessions.entries()) {
    if (session.expireAt && now > session.expireAt) collectionSessions.delete(key);
  }
}, 5 * 60 * 1000);

function getRarityOrder(rarity) { return RARITY_ORDER[rarity] ?? 999; }

function organizeCardsByRarity(cardsGrouped) {
  const byRarity = {};
  for (const [cardId, cardData] of Object.entries(cardsGrouped)) {
    const rarity = cardData.card.rareté;
    if (!byRarity[rarity]) byRarity[rarity] = [];
    byRarity[rarity].push([cardId, cardData]);
  }
  const sortedRarities = Object.keys(byRarity).sort((a, b) => getRarityOrder(a) - getRarityOrder(b));
  const pages = [];
  for (const rarity of sortedRarities) {
    const rarityCards = byRarity[rarity];
    for (let i = 0; i < rarityCards.length; i += CARDS_PER_PAGE) {
      pages.push({ rarity, cards: rarityCards.slice(i, i + CARDS_PER_PAGE), isContinuation: i > 0 });
    }
  }
  return pages;
}

function createCollectionEmbed(userName, pageData, currentPage, totalPages, uniqueCards, totalCards, coins, isSelf) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 Collection de ${userName}`)
    .setDescription(
      `🎴 ${pluralCartes(totalCards)}\n`
      + `✨ ${uniqueCards} unique${uniqueCards > 1 ? 's' : ''}`
      + `\n🪙 Solde : **${coins} PSG Coins**`
      + `\n📄 Page : ${currentPage}/${totalPages}`,
    )
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Sélectionne une carte pour voir ses détails • Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

  if (!pageData?.cards?.length) {
    embed.addFields({ name: '🔭 Collection vide', value: 'Achète des packs pour commencer ta collection !', inline: false });
    return embed;
  }

  const { rarity, cards, isContinuation } = pageData;
  let sectionTitle = `${getRarityEmoji(rarity)}  ${rarity}`;
  if (isContinuation) sectionTitle += ' (suite)';

  embed.addFields({
    name:   sectionTitle,
    value:  cards.map(([, d]) => {
      const displayName = d.card.rareté === 'Legend'
        ? `👑 ${d.card.nom} 👑`
        : d.card.nom;
      return `${CARD_TYPES[d.card.type]?.emoji || '🎴'} ${displayName} x${d.count}`;
    }).join('\n'),
    inline: false,
  });

  return embed;
}

function buildCollectionComponents(pages, currentPage, totalPages, cardsGrouped, viewerId) {
  const rows    = [];
  const pageData = pages[currentPage];
  if (pageData?.cards?.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`gr_coll_card_${viewerId}`)
        .setPlaceholder(`🎴 ${pageData.rarity} - Page ${currentPage + 1}/${totalPages}`)
        .addOptions(pageData.cards.map(([cardId, cardData]) => ({
          label:       `${cardData.card.nom} x${cardData.count}`.slice(0, 100),
          description: `${CARD_TYPES[cardData.card.type]?.emoji || '🎴'} ${cardData.card.type?.charAt(0).toUpperCase() + cardData.card.type?.slice(1)} - ${cardData.card.rareté}`.slice(0, 100),
          value:       cardId,
          emoji:       getRarityEmoji(cardData.card.rareté),
        }))),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gr_coll_prev_${viewerId}`).setLabel('◀️ Précédent').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`gr_coll_next_${viewerId}`).setLabel('Suivant ▶️').setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages - 1),
    new ButtonBuilder().setCustomId(`gr_coll_refresh_${viewerId}`).setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

// ─── Helper : recrée une session si absente ────────────────────────────────────
function restoreSession(viewerId, guildId, userName) {
  const cardsGrouped = getUserCardsGrouped(guildId, viewerId);
  const pages        = organizeCardsByRarity(cardsGrouped);
  const totalUnique  = Object.keys(cardsGrouped).length;
  const totalCards   = Object.values(cardsGrouped).reduce((s, d) => s + d.count, 0);
  const userData     = getUserData(guildId, viewerId);

  const session = {
    guildId,
    userId:      viewerId,
    userName:    userName || 'Toi',
    cardsGrouped,
    pages,
    currentPage: 0,
    totalUnique,
    totalCards,
    targetCoins: userData.coins,
    isSelf:      true,
    expireAt:    Date.now() + 15 * 60 * 1000,
  };

  collectionSessions.set(viewerId, session);
  return session;
}

// ─── GESTION INTERACTIONS COLLECTION ──────────────────────────────────────────
async function handleCollectionInteraction(interaction) {
  const customId = interaction.customId;

  // ── Sélection d'un membre ─────────────────────────────────────────────────
  if (customId.startsWith('gr_coll_user_select_')) {
    const requesterId = customId.replace('gr_coll_user_select_', '');
    if (interaction.user.id !== requesterId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue !", flags: MessageFlags.Ephemeral });
    }
    const targetUser = interaction.users.first();
    if (!targetUser) return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const targetName   = targetMember?.displayName || targetUser.username;
    return showCollection(interaction, targetUser.id, targetName);
  }

  // ── Ma collection ─────────────────────────────────────────────────────────
  if (customId.startsWith('gr_coll_self_')) {
    const requesterId = customId.replace('gr_coll_self_', '');
    if (interaction.user.id !== requesterId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue !", flags: MessageFlags.Ephemeral });
    }
    const targetMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const targetName   = targetMember?.displayName || interaction.user.username;
    return showCollection(interaction, interaction.user.id, targetName);
  }

  // ── Détail d'une carte ────────────────────────────────────────────────────
  if (customId.startsWith('gr_coll_card_')) {
    const viewerId = customId.replace('gr_coll_card_', '');
    if (interaction.user.id !== viewerId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    }

    const session   = collectionSessions.get(viewerId)
      ?? restoreSession(viewerId, interaction.guildId, interaction.user.displayName);
    const cardEntry = session.cardsGrouped[interaction.values[0]];
    const card      = cardEntry?.card;
    if (!card) return interaction.reply({ content: '❌ Carte introuvable.', flags: MessageFlags.Ephemeral });

    const count        = cardEntry.count;
    const typeEmoji    = CARD_TYPES[card.type]?.emoji || '🎴';
    const artistCredit = formatArtistCredit(card);

    const embed = new EmbedBuilder()
      .setTitle(`🎴 ${formatCardName(card)}`)
      .setDescription(`Carte ${card.type} de ${session.userName}`)
      .setColor(getRarityColor(card.rareté))
      .addFields(
        { name: `${typeEmoji} Type`, value: card.type?.charAt(0).toUpperCase() + card.type?.slice(1), inline: true },
        { name: '🏆 Rareté',         value: `${getRarityEmoji(card.rareté)} ${card.rareté}`, inline: true },
        { name: '📊 Statistiques',   value: formatCardStats(card), inline: false },
        { name: '📦 Exemplaires',    value: `x${count}`, inline: true },
      )
      .setFooter({ text: "Paris Saint-Germain • Ici c'est Paris", iconURL: PSG_FOOTER_ICON });

    if (artistCredit) embed.addFields({ name: '\u200b', value: artistCredit, inline: false });

    const imageFile = getCardImageFile(card);
    if (imageFile) {
      embed.setImage(`attachment://${imageFile.name}`);
      return interaction.reply({ embeds: [embed], files: [imageFile], flags: MessageFlags.Ephemeral });
    }
    const cardImageUrl = getCardImageUrlLocal(card);
    if (cardImageUrl) embed.setImage(cardImageUrl);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ── Navigation pages ──────────────────────────────────────────────────────
  if (customId.startsWith('gr_coll_prev_') || customId.startsWith('gr_coll_next_') || customId.startsWith('gr_coll_refresh_')) {
    const isPrev   = customId.startsWith('gr_coll_prev_');
    const isNext   = customId.startsWith('gr_coll_next_');
    const viewerId = customId.replace(/^gr_coll_(prev|next|refresh)_/, '');
    if (interaction.user.id !== viewerId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    }

    const session = collectionSessions.get(viewerId)
      ?? restoreSession(viewerId, interaction.guildId, interaction.user.displayName);

    if (isPrev)      session.currentPage = Math.max(0, session.currentPage - 1);
    else if (isNext) session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 1);
    else {
      const fresh         = getUserCardsGrouped(session.guildId, session.userId);
      const freshUserData = getUserData(session.guildId, session.userId);
      session.cardsGrouped = fresh;
      session.pages        = organizeCardsByRarity(fresh);
      session.totalUnique  = Object.keys(fresh).length;
      session.totalCards   = Object.values(fresh).reduce((s, d) => s + d.count, 0);
      session.targetCoins  = freshUserData.coins;
      session.currentPage  = Math.min(session.currentPage, Math.max(0, session.pages.length - 1));
      session.expireAt     = Date.now() + 15 * 60 * 1000;
    }

    return interaction.update({
      embeds: [createCollectionEmbed(
        session.userName,
        session.pages[session.currentPage],
        session.currentPage + 1,
        session.pages.length,
        session.totalUnique,
        session.totalCards,
        session.targetCoins,
        session.isSelf,
      )],
      components: buildCollectionComponents(session.pages, session.currentPage, session.pages.length, session.cardsGrouped, viewerId),
    });
  }
}

module.exports = {
  sendGamingRoomEmbed,
  handleBoosters,
  handleBuyPack,
  handlePortefeuille: () => {},
  handleCollection,
  handleCollectionInteraction,
};