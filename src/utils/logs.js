// src/utils/logs.js - Système de logs complet
const { EmbedBuilder } = require('discord.js');
const { loadServerConfig } = require('./permissions');
const { PSG_BLUE, PSG_RED } = require('../config/settings');

async function getLogsChannel(guild) {
  const config = loadServerConfig(String(guild.id));
  if (!config?.logs_channel) return null;
  try {
    return guild.channels.cache.get(String(config.logs_channel)) || null;
  } catch {
    return null;
  }
}

async function safeSend(channel, embed) {
  try {
    await channel.send({ embeds: [embed] });
  } catch { /* silencieux */ }
}

// ==================== LOGS MEMBRES ====================

async function logMemberJoin(member) {
  const channel = await getLogsChannel(member.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('📥 Membre rejoint')
    .setDescription(`${member} a rejoint le serveur`)
    .setColor(0x00FF00)
    .addFields(
      { name: '👤 Membre', value: `${member.user.username}\n${member}`, inline: true },
      { name: '🆔 ID', value: member.id, inline: true },
      { name: '📅 Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setThumbnail(member.displayAvatarURL())
    .setFooter({ text: `Membres: ${member.guild.memberCount}` })
    .setTimestamp();

  await safeSend(channel, embed);
}

async function logMemberLeave(member) {
  const channel = await getLogsChannel(member.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('📤 Membre parti')
    .setDescription(`${member} a quitté le serveur`)
    .setColor(0xFF0000)
    .addFields(
      { name: '👤 Membre', value: `${member.user.username}\n${member}`, inline: true },
      { name: '🆔 ID', value: member.id, inline: true },
    )
    .setThumbnail(member.displayAvatarURL())
    .setFooter({ text: `Membres: ${member.guild.memberCount}` })
    .setTimestamp();

  if (member.joinedTimestamp) {
    embed.addFields({ name: '📅 A rejoint', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
  }
  if (member.roles.cache.size > 1) {
    const roles = member.roles.cache
      .filter(r => r.name !== '@everyone')
      .first(6)
      .map(r => r.toString())
      .join(', ');
    embed.addFields({ name: '🎭 Rôles', value: roles || 'Aucun', inline: false });
  }

  await safeSend(channel, embed);
}

async function logMemberUpdate(oldMember, newMember) {
  const channel = await getLogsChannel(oldMember.guild);
  if (!channel) return;

  // Pseudo
  if (oldMember.nickname !== newMember.nickname) {
    const embed = new EmbedBuilder()
      .setTitle('✏️ Pseudo modifié')
      .setDescription(`**Membre:** ${newMember}`)
      .setColor(PSG_BLUE)
      .addFields(
        { name: '📝 Avant', value: oldMember.nickname || 'Aucun', inline: true },
        { name: '📝 Après', value: newMember.nickname || 'Aucun', inline: true },
      )
      .setThumbnail(newMember.displayAvatarURL())
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp();
    await safeSend(channel, embed);
  }

  // Rôles
  const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
  if (added.size || removed.size) {
    const embed = new EmbedBuilder()
      .setTitle('🎭 Rôles modifiés')
      .setDescription(`**Membre:** ${newMember}`)
      .setColor(PSG_BLUE)
      .setThumbnail(newMember.displayAvatarURL())
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp();
    if (added.size) embed.addFields({ name: '➕ Ajoutés', value: added.map(r => r.toString()).join(', '), inline: false });
    if (removed.size) embed.addFields({ name: '➖ Retirés', value: removed.map(r => r.toString()).join(', '), inline: false });
    await safeSend(channel, embed);
  }

  // Timeout
  if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
    const embed = new EmbedBuilder()
      .setDescription(`**Membre:** ${newMember}`)
      .setThumbnail(newMember.displayAvatarURL())
      .setFooter({ text: `ID: ${newMember.id}` })
      .setTimestamp();
    if (newMember.communicationDisabledUntil) {
      embed.setTitle('🔇 Membre rendu muet').setColor(PSG_RED)
        .addFields({ name: '⏰ Jusqu\'à', value: `<t:${Math.floor(newMember.communicationDisabledUntil.getTime() / 1000)}:F>`, inline: false });
    } else {
      embed.setTitle('🔊 Membre démuté').setColor(0x00FF00);
    }
    await safeSend(channel, embed);
  }
}

// ==================== LOGS MESSAGES ====================

async function logMessageDelete(message) {
  if (message.author?.bot) return;
  const channel = await getLogsChannel(message.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setDescription(`**Auteur:** ${message.author}\n**Salon:** ${message.channel}`)
    .setColor(PSG_RED)
    .setFooter({ text: `ID Message: ${message.id} • ID Auteur: ${message.author?.id}` })
    .setTimestamp();

  if (message.content) embed.addFields({ name: '📝 Contenu', value: message.content.slice(0, 1024), inline: false });
  if (message.attachments.size) {
    const attachments = message.attachments.map(a => `[${a.name}](${a.url})`).slice(0, 5).join('\n');
    embed.addFields({ name: '📎 Pièces jointes', value: attachments, inline: false });
  }

  await safeSend(channel, embed);
}

async function logMessageEdit(oldMessage, newMessage) {
  if (oldMessage.author?.bot || oldMessage.content === newMessage.content) return;
  const channel = await getLogsChannel(oldMessage.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('✏️ Message modifié')
    .setDescription(`**Auteur:** ${oldMessage.author}\n**Salon:** ${oldMessage.channel}\n[Aller au message](${newMessage.url})`)
    .setColor(0xFFA500)
    .setFooter({ text: `ID Message: ${oldMessage.id} • ID Auteur: ${oldMessage.author?.id}` })
    .setTimestamp();

  if (oldMessage.content) embed.addFields({ name: '📝 Avant', value: oldMessage.content.slice(0, 1024), inline: false });
  if (newMessage.content) embed.addFields({ name: '📝 Après', value: newMessage.content.slice(0, 1024), inline: false });

  await safeSend(channel, embed);
}

async function logBulkDelete(messages, channel) {
  const logsChannel = await getLogsChannel(channel.guild);
  if (!logsChannel) return;

  const authors = {};
  for (const msg of messages.values()) {
    const name = msg.author?.username || 'Inconnu';
    authors[name] = (authors[name] || 0) + 1;
  }

  const authorsText = Object.entries(authors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}: ${count}`)
    .join('\n') || 'Aucun';

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Suppression en masse')
    .setDescription(`**${messages.size}** messages supprimés dans ${channel}`)
    .setColor(PSG_RED)
    .addFields({ name: '👥 Auteurs', value: authorsText, inline: false })
    .setFooter({ text: `Salon: ${channel.name}` })
    .setTimestamp();

  await safeSend(logsChannel, embed);
}

// ==================== LOGS VOCAUX ====================

async function logVoiceState(member, before, after) {
  const channel = await getLogsChannel(member.guild);
  if (!channel) return;

  let embed = null;

  if (!before.channel && after.channel) {
    embed = new EmbedBuilder().setTitle('🔊 Connexion vocale').setDescription(`${member} a rejoint ${after.channel}`).setColor(0x00FF00);
  } else if (before.channel && !after.channel) {
    embed = new EmbedBuilder().setTitle('🔇 Déconnexion vocale').setDescription(`${member} a quitté ${before.channel}`).setColor(0xFF0000);
  } else if (before.channel && after.channel && before.channel.id !== after.channel.id) {
    embed = new EmbedBuilder().setTitle('🔄 Changement de salon vocal').setDescription(`${member} est passé de ${before.channel} à ${after.channel}`).setColor(PSG_BLUE);
  } else if (before.selfMute !== after.selfMute || before.serverMute !== after.serverMute) {
    const muted = after.selfMute || after.serverMute;
    embed = new EmbedBuilder()
      .setTitle(muted ? '🔇 Membre muté (vocal)' : '🔊 Membre démuté (vocal)')
      .setDescription(`${member} ${muted ? 's\'est mis en mute' : 'a enlevé son mute'}`)
      .setColor(muted ? 0xFF6B6B : 0x51CF66);
  } else if (before.selfVideo !== after.selfVideo) {
    embed = new EmbedBuilder()
      .setTitle(after.selfVideo ? '📹 Caméra activée' : '📹 Caméra désactivée')
      .setDescription(`${member} ${after.selfVideo ? `a activé sa caméra dans ${after.channel}` : 'a désactivé sa caméra'}`)
      .setColor(PSG_BLUE);
  } else if (before.streaming !== after.streaming) {
    embed = new EmbedBuilder()
      .setTitle(after.streaming ? '🖥️ Partage d\'écran activé' : '🖥️ Partage d\'écran désactivé')
      .setDescription(`${member} ${after.streaming ? `partage son écran dans ${after.channel}` : 'a arrêté de partager son écran'}`)
      .setColor(PSG_BLUE);
  }

  if (embed) {
    embed.setThumbnail(member.displayAvatarURL()).setFooter({ text: `Membre: ${member.user.username}` }).setTimestamp();
    await safeSend(channel, embed);
  }
}

// ==================== LOGS SALONS ====================

async function logChannelCreate(channelObj) {
  const logsChannel = await getLogsChannel(channelObj.guild);
  if (!logsChannel) return;
  const type = channelObj.isTextBased() ? 'Textuel' : channelObj.isVoiceBased() ? 'Vocal' : 'Autre';
  const embed = new EmbedBuilder()
    .setTitle('➕ Salon créé')
    .setDescription(`**Nom:** ${channelObj.toString?.() || channelObj.name}\n**Type:** ${type}`)
    .setColor(0x00FF00)
    .addFields({ name: '🆔 ID', value: channelObj.id, inline: true })
    .setTimestamp();
  if (channelObj.parent) embed.addFields({ name: '📁 Catégorie', value: channelObj.parent.name, inline: true });
  await safeSend(logsChannel, embed);
}

async function logChannelDelete(channelObj) {
  const logsChannel = await getLogsChannel(channelObj.guild);
  if (!logsChannel) return;
  const type = channelObj.isTextBased?.() ? 'Textuel' : channelObj.isVoiceBased?.() ? 'Vocal' : 'Autre';
  const embed = new EmbedBuilder()
    .setTitle('➖ Salon supprimé')
    .setDescription(`**Nom:** ${channelObj.name}\n**Type:** ${type}`)
    .setColor(PSG_RED)
    .addFields({ name: '🆔 ID', value: channelObj.id, inline: true })
    .setTimestamp();
  if (channelObj.parent) embed.addFields({ name: '📁 Catégorie', value: channelObj.parent.name, inline: true });
  await safeSend(logsChannel, embed);
}

async function logChannelUpdate(oldChannel, newChannel) {
  const logsChannel = await getLogsChannel(oldChannel.guild);
  if (!logsChannel) return;

  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push({ name: '📝 Nom', value: `${oldChannel.name} → ${newChannel.name}` });
  if (oldChannel.topic !== newChannel.topic) changes.push({ name: '📋 Description', value: `${oldChannel.topic || 'Aucune'} → ${newChannel.topic || 'Aucune'}` });
  if (oldChannel.parentId !== newChannel.parentId) changes.push({ name: '📁 Catégorie', value: `${oldChannel.parent?.name || 'Aucune'} → ${newChannel.parent?.name || 'Aucune'}` });
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) changes.push({ name: '⏱️ Mode lent', value: `${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s` });
  if (oldChannel.nsfw !== newChannel.nsfw) changes.push({ name: '🔞 NSFW', value: newChannel.nsfw ? 'Oui' : 'Non' });

  if (!changes.length) return;

  const embed = new EmbedBuilder()
    .setTitle('✏️ Salon modifié')
    .setDescription(`**Salon:** ${newChannel.toString?.() || newChannel.name}`)
    .setColor(PSG_BLUE)
    .addFields(...changes.map(c => ({ ...c, inline: false })))
    .setFooter({ text: `ID: ${newChannel.id}` })
    .setTimestamp();
  await safeSend(logsChannel, embed);
}

// ==================== LOGS RÔLES ====================

async function logRoleCreate(role) {
  const channel = await getLogsChannel(role.guild);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🎭 Rôle créé')
    .setDescription(`**Nom:** ${role}`)
    .setColor(role.color || 0x00FF00)
    .addFields(
      { name: '🆔 ID', value: role.id, inline: true },
      { name: '🎨 Couleur', value: role.hexColor, inline: true },
      { name: '🔢 Position', value: String(role.position), inline: true },
      { name: '📌 Affiché séparément', value: role.hoist ? 'Oui' : 'Non', inline: true },
      { name: '🔗 Mentionnable', value: role.mentionable ? 'Oui' : 'Non', inline: true },
    )
    .setTimestamp();
  await safeSend(channel, embed);
}

async function logRoleDelete(role) {
  const channel = await getLogsChannel(role.guild);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🎭 Rôle supprimé')
    .setDescription(`**Nom:** ${role.name}`)
    .setColor(role.color || PSG_RED)
    .addFields(
      { name: '🆔 ID', value: role.id, inline: true },
      { name: '🎨 Couleur', value: role.hexColor, inline: true },
      { name: '👥 Membres', value: String(role.members.size), inline: true },
    )
    .setTimestamp();
  await safeSend(channel, embed);
}

async function logRoleUpdate(oldRole, newRole) {
  const channel = await getLogsChannel(oldRole.guild);
  if (!channel) return;

  const changes = [];
  if (oldRole.name !== newRole.name) changes.push({ name: '📝 Nom', value: `${oldRole.name} → ${newRole.name}` });
  if (oldRole.color !== newRole.color) changes.push({ name: '🎨 Couleur', value: `${oldRole.hexColor} → ${newRole.hexColor}` });
  if (oldRole.hoist !== newRole.hoist) changes.push({ name: '📌 Affiché séparément', value: newRole.hoist ? 'Oui' : 'Non' });
  if (oldRole.mentionable !== newRole.mentionable) changes.push({ name: '🔗 Mentionnable', value: newRole.mentionable ? 'Oui' : 'Non' });
  if (!oldRole.permissions.equals(newRole.permissions)) changes.push({ name: '🔐 Permissions', value: 'Modifiées' });

  if (!changes.length) return;

  const embed = new EmbedBuilder()
    .setTitle('✏️ Rôle modifié')
    .setDescription(`**Rôle:** ${newRole}`)
    .setColor(newRole.color || PSG_BLUE)
    .addFields(...changes.map(c => ({ ...c, inline: false })))
    .setFooter({ text: `ID: ${newRole.id}` })
    .setTimestamp();
  await safeSend(channel, embed);
}

// ==================== LOGS SERVEUR ====================

async function logGuildUpdate(oldGuild, newGuild) {
  const channel = await getLogsChannel(newGuild);
  if (!channel) return;

  const changes = [];
  if (oldGuild.name !== newGuild.name) changes.push({ name: '📝 Nom', value: `${oldGuild.name} → ${newGuild.name}` });
  if (oldGuild.icon !== newGuild.icon) changes.push({ name: '🖼️ Icône', value: 'Modifiée' });
  if (oldGuild.banner !== newGuild.banner) changes.push({ name: '🎨 Bannière', value: 'Modifiée' });
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push({ name: '🔒 Niveau de vérification', value: `${oldGuild.verificationLevel} → ${newGuild.verificationLevel}` });

  if (!changes.length) return;

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Serveur modifié')
    .setColor(PSG_BLUE)
    .addFields(...changes.map(c => ({ ...c, inline: false })))
    .setTimestamp();
  if (newGuild.iconURL()) embed.setThumbnail(newGuild.iconURL());
  await safeSend(channel, embed);
}

// ==================== LOGS COMMANDES ====================

async function logCommandUse(interaction, commandName, success = true, error = null) {
  const channel = await getLogsChannel(interaction.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(success ? '✅ Commande exécutée' : '❌ Commande échouée')
    .setDescription(`**Utilisateur:** ${interaction.user}\n**Commande:** \`/${commandName}\``)
    .setColor(success ? PSG_BLUE : PSG_RED)
    .addFields({ name: '📺 Salon', value: interaction.channel?.toString() || 'DM', inline: true })
    .setFooter({ text: `ID: ${interaction.user.id}` })
    .setTimestamp();

  const options = interaction.options?.data || [];
  if (options.length) {
    const params = options.slice(0, 5).map(o => `• ${o.name}: \`${String(o.value).slice(0, 100)}\``).join('\n');
    embed.addFields({ name: '⚙️ Paramètres', value: params, inline: false });
  }

  if (error) {
    embed.addFields({ name: '⚠️ Erreur', value: `\`\`\`${String(error).slice(0, 500)}\`\`\``, inline: false });
  }

  await safeSend(channel, embed);
}

module.exports = {
  logMemberJoin,
  logMemberLeave,
  logMemberUpdate,
  logMessageDelete,
  logMessageEdit,
  logBulkDelete,
  logVoiceState,
  logChannelCreate,
  logChannelDelete,
  logChannelUpdate,
  logRoleCreate,
  logRoleDelete,
  logRoleUpdate,
  logGuildUpdate,
  logCommandUse,
};
