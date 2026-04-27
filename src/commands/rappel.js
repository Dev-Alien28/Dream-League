// src/commands/rappel.js - Système de rappels automatiques configurables
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const { loadServerConfig, saveServerConfig, checkConfigPermission } = require('../utils/permissions');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON } = require('../config/settings');

// ─── Stockage en mémoire des intervalles actifs ────────────────────────────────
// Map<guildId, Map<rappelId, intervalRef>>
const activeIntervals = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRappels(guildId) {
  const config = loadServerConfig(guildId);
  return config?.rappels || [];
}

function saveRappels(guildId, rappels) {
  const config = loadServerConfig(guildId) || {};
  config.rappels = rappels;
  saveServerConfig(guildId, config);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Parse "8h", "08h30", "16h00", "8:30", "16" → { hours, minutes }
 * Retourne null si invalide.
 */
function parseHeure(raw) {
  const s = raw.trim().replace(',', '.');

  // Formats acceptés : "8h", "8h30", "08h30", "8:30", "16:00", "16"
  const match =
    s.match(/^(\d{1,2})h(\d{0,2})$/i) ||
    s.match(/^(\d{1,2}):(\d{0,2})$/) ||
    s.match(/^(\d{1,2})$/);

  if (!match) return null;

  const hours   = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2] || '0', 10) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function formatHeure({ hours, minutes }) {
  return `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}`;
}

/**
 * Calcule le délai en ms jusqu'au prochain déclenchement de l'heure donnée.
 * Repère le prochain instant dans le futur (aujourd'hui ou demain).
 */
function msUntilNext(hours, minutes) {
  const now    = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

// ─── Planification d'un rappel ────────────────────────────────────────────────

function scheduleRappel(client, guildId, rappel) {
  const { id, heures, channelId, message, roleId } = rappel;

  if (!activeIntervals.has(guildId)) activeIntervals.set(guildId, new Map());
  const guildIntervals = activeIntervals.get(guildId);

  // Annule l'ancien si existant
  cancelRappel(guildId, id);

  // Planifie chaque heure indépendamment
  for (const heure of heures) {
    const { hours, minutes } = heure;
    const key = `${id}_${hours}_${minutes}`;

    const fire = async () => {
      const guild   = client.guilds.cache.get(guildId);
      if (!guild) return;
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setTitle('📢 Rappel')
        .setDescription(message)
        .setColor(PSG_BLUE)
        .setFooter({ text: `Paris Saint-Germain • ${guild.name}`, iconURL: PSG_FOOTER_ICON })
        .setTimestamp();

      const content = roleId ? `<@&${roleId}>` : undefined;
      try {
        await channel.send({ content, embeds: [embed] });
      } catch (e) {
        console.error(`❌ Erreur envoi rappel ${id} (${formatHeure(heure)}):`, e.message);
      }

      // Re-planifie pour le lendemain
      const timeout = setTimeout(fire, msUntilNext(hours, minutes));
      guildIntervals.set(key, timeout);
    };

    const timeout = setTimeout(fire, msUntilNext(hours, minutes));
    guildIntervals.set(key, timeout);
    console.log(`⏰ Rappel [${id}] planifié à ${formatHeure(heure)} sur guild ${guildId}`);
  }
}

function cancelRappel(guildId, rappelId) {
  const guildIntervals = activeIntervals.get(guildId);
  if (!guildIntervals) return;
  for (const [key, ref] of guildIntervals.entries()) {
    if (key.startsWith(`${rappelId}_`)) {
      clearTimeout(ref);
      guildIntervals.delete(key);
    }
  }
}

/**
 * Appelé au démarrage du bot pour re-planifier tous les rappels sauvegardés.
 */
function initAllRappels(client) {
  for (const guild of client.guilds.cache.values()) {
    const rappels = getRappels(String(guild.id));
    for (const rappel of rappels) {
      if (rappel.actif !== false) {
        scheduleRappel(client, String(guild.id), rappel);
      }
    }
  }
  console.log('✅ Rappels automatiques initialisés');
}

// ─── Sous-commandes ────────────────────────────────────────────────────────────

async function rappelCommand(interaction) {
  // Vérifie la permission (même niveau que /config)
  if (!checkConfigPermission(interaction)) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Accès refusé')
        .setDescription("Tu n'as pas la permission de gérer les rappels.")
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'creer')    return handleCreer(interaction);
  if (sub === 'liste')    return handleListe(interaction);
  if (sub === 'supprimer') return handleSupprimer(interaction);
}

// ─── /rappel creer ────────────────────────────────────────────────────────────

async function handleCreer(interaction) {
  const guildId  = interaction.guildId;
  const salon    = interaction.options.getChannel('salon');
  const message  = interaction.options.getString('message');
  const heuresRaw = interaction.options.getString('heures');
  const role     = interaction.options.getRole('role') || null;

  // Parse les heures (séparées par virgule ou espace)
  const tokens = heuresRaw.split(/[\s,;]+/).filter(Boolean);
  const heures = [];
  const invalides = [];

  for (const token of tokens) {
    const parsed = parseHeure(token);
    if (parsed) {
      // Dédoublonnage
      if (!heures.some(h => h.hours === parsed.hours && h.minutes === parsed.minutes)) {
        heures.push(parsed);
      }
    } else {
      invalides.push(token);
    }
  }

  if (invalides.length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Heure(s) invalide(s)')
        .setDescription(
          `Ces heures n'ont pas pu être lues : \`${invalides.join(', ')}\`\n\n`
          + '**Formats acceptés :** `8h`, `08h30`, `16h00`, `8:30`, `16`\n'
          + '**Exemple :** `8h 16h` ou `8h30, 12h, 20h`',
        )
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!heures.length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Aucune heure fournie')
        .setDescription('Indique au moins une heure. Exemple : `8h 16h`')
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Crée et sauvegarde
  const rappels = getRappels(guildId);
  const id      = generateId();
  const nouveau = {
    id,
    channelId: salon.id,
    message,
    heures,
    roleId:    role?.id || null,
    actif:     true,
    createdAt: new Date().toISOString(),
  };

  rappels.push(nouveau);
  saveRappels(guildId, rappels);
  scheduleRappel(interaction.client, guildId, nouveau);

  const heuresList = heures.map(h => `**${formatHeure(h)}**`).join(', ');

  const embed = new EmbedBuilder()
    .setTitle('✅ Rappel créé !')
    .setColor(PSG_BLUE)
    .addFields(
      { name: '📺 Salon',        value: salon.toString(),                             inline: true  },
      { name: '⏰ Heures',       value: heuresList,                                   inline: true  },
      { name: '🔔 Rôle mentionné', value: role ? role.toString() : 'Aucun',           inline: true  },
      { name: '💬 Message',      value: message.slice(0, 1024),                       inline: false },
      { name: '🆔 ID du rappel', value: `\`${id}\``,                                  inline: false },
    )
    .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── /rappel liste ────────────────────────────────────────────────────────────

async function handleListe(interaction) {
  const guildId = interaction.guildId;
  const rappels  = getRappels(guildId);

  if (!rappels.length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('📢 Rappels configurés')
        .setDescription('Aucun rappel configuré sur ce serveur.\n\nUtilise `/rappel creer` pour en ajouter un !')
        .setColor(PSG_BLUE)
        .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('📢 Rappels configurés')
    .setDescription(`**${rappels.length}** rappel${rappels.length > 1 ? 's' : ''} actif${rappels.length > 1 ? 's' : ''} sur ce serveur.`)
    .setColor(PSG_BLUE)
    .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON })
    .setTimestamp();

  for (const r of rappels) {
    const channel = interaction.guild.channels.cache.get(r.channelId);
    const role    = r.roleId ? interaction.guild.roles.cache.get(r.roleId) : null;
    const heures  = r.heures.map(h => formatHeure(h)).join(', ');

    embed.addFields({
      name:   `🆔 \`${r.id}\``,
      value:
        `📺 **Salon :** ${channel ? channel.toString() : `Inconnu (\`${r.channelId}\`)`}\n`
        + `⏰ **Heures :** ${heures}\n`
        + `🔔 **Rôle :** ${role ? role.toString() : 'Aucun'}\n`
        + `💬 **Message :** ${r.message.slice(0, 100)}${r.message.length > 100 ? '…' : ''}`,
      inline: false,
    });
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── /rappel supprimer ────────────────────────────────────────────────────────

async function handleSupprimer(interaction) {
  const guildId  = interaction.guildId;
  const rappelId = interaction.options.getString('id').trim();
  const rappels  = getRappels(guildId);

  const index = rappels.findIndex(r => r.id === rappelId);
  if (index === -1) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Rappel introuvable')
        .setDescription(`Aucun rappel avec l'ID \`${rappelId}\`.\n\nUtilise \`/rappel liste\` pour voir les IDs.`)
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  cancelRappel(guildId, rappelId);
  rappels.splice(index, 1);
  saveRappels(guildId, rappels);

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('✅ Rappel supprimé')
      .setDescription(`Le rappel \`${rappelId}\` a été supprimé et ne se déclenchera plus.`)
      .setColor(PSG_BLUE)
      .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON })],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { rappelCommand, initAllRappels };