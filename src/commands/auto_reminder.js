// src/commands/auto_reminder.js - Système de rappels automatiques (Enmap)
const { EmbedBuilder } = require('discord.js');
const { PSG_BLUE, PSG_FOOTER_ICON } = require('../config/settings');
const {
  initReminderGuild,
  getReminderConfig,
  setReminderConfig,
  getAllReminderConfigs,
  deleteReminderConfig,
} = require('../utils/database');

class AutoReminder {
  constructor(client) {
    this.client = client;
    this._restartFlag = false;
    this._currentTimer = null;
  }

  // Lecture / écriture via Enmap
  _get(guildId) {
    return getReminderConfig(String(guildId));
  }

  _set(guildId, data) {
    setReminderConfig(String(guildId), data);
  }

  _ensure(guildId) {
    initReminderGuild(String(guildId));
    return this._get(guildId);
  }

  // ==================== SETTERS ====================

  setReminderChannel(guildId, channelId) {
    const cfg = this._ensure(guildId);
    cfg.channel_id = channelId;
    this._set(guildId, cfg);
  }

  setDiscussionChannel(guildId, channelId) {
    const cfg = this._ensure(guildId);
    cfg.discussion_channel_id = channelId;
    this._set(guildId, cfg);
  }

  setInterval(guildId, hours) {
    const cfg = this._ensure(guildId);
    cfg.interval_hours = hours;
    this._set(guildId, cfg);
    this._triggerRestart();
  }

  enableReminders(guildId) {
    const cfg = this._ensure(guildId);
    if (!cfg.channel_id) return false;
    cfg.enabled = true;
    this._set(guildId, cfg);
    this._triggerRestart();
    return true;
  }

  disableReminders(guildId) {
    const cfg = this._ensure(guildId);
    cfg.enabled = false;
    this._set(guildId, cfg);
  }

  removeReminderChannel(guildId) {
    deleteReminderConfig(String(guildId));
  }

  // ==================== GETTERS ====================

  getInterval(guildId) {
    return parseFloat(this._get(guildId)?.interval_hours ?? 6.0);
  }

  getChannelId(guildId) {
    return this._get(guildId)?.channel_id || null;
  }

  getDiscussionChannelId(guildId) {
    return this._get(guildId)?.discussion_channel_id || null;
  }

  isEnabled(guildId) {
    return this._get(guildId)?.enabled || false;
  }

  // ==================== UTILS ====================

  formatInterval(hours) {
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
    if (hours === 1) return '1 heure';
    return `${Math.floor(hours)} heures`;
  }

  _triggerRestart() {
    this._restartFlag = true;
    if (this._currentTimer) {
      clearTimeout(this._currentTimer);
      this._currentTimer = null;
      this._loop();
    }
  }

  // ==================== ENVOI ====================

  async sendReminders() {
    const allConfigs = getAllReminderConfigs();

    for (const [guildId, settings] of Object.entries(allConfigs)) {
      if (!settings.enabled || !settings.channel_id) continue;

      try {
        const channel = this.client.channels.cache.get(settings.channel_id)
          || await this.client.channels.fetch(settings.channel_id).catch(() => null);

        if (!channel) {
          console.warn(`⚠️ Salon ${settings.channel_id} introuvable pour ${guildId}`);
          continue;
        }

        let discussionText = '💬 Pour discuter, utilisez les autres salons du serveur !';
        if (settings.discussion_channel_id) {
          const discChannel = this.client.channels.cache.get(settings.discussion_channel_id);
          if (discChannel) discussionText = `💬 Pour discuter, utilisez le salon ${discChannel}`;
        }

        const intervalLabel = this.formatInterval(parseFloat(settings.interval_hours || 6));

        const embed = new EmbedBuilder()
          .setTitle('📢 RAPPEL AUTOMATIQUE')
          .setDescription(
            '**Ce salon est réservé au jeu PSG Dream League !**\n\n'
            + '🚫 **Merci de ne pas discuter ici**\n\n'
            + '✅ **Commandes disponibles :**\n'
            + '• `/packs` - Acheter des packs de cartes\n'
            + '• `/collection` - Voir ta collection\n'
            + '• `/solde` - Voir ton solde de PSG Coins\n\n'
            + discussionText,
          )
          .setColor(PSG_BLUE)
          .setFooter({ text: `Ce message apparaît automatiquement toutes les ${intervalLabel}`, iconURL: PSG_FOOTER_ICON });

        await channel.send({ embeds: [embed] });
        console.log(`✅ Rappel envoyé dans ${channel.name} (${guildId})`);
      } catch (e) {
        console.error(`❌ Erreur rappel pour ${guildId}:`, e.message);
      }
    }
  }

  // ==================== BOUCLE ====================

  async _loop() {
    this._restartFlag = false;

    await this.sendReminders();

    const allConfigs = getAllReminderConfigs();
    let minInterval = 6 * 3600 * 1000;
    for (const [, settings] of Object.entries(allConfigs)) {
      if (settings.enabled) {
        const ms = parseFloat(settings.interval_hours || 6) * 3600 * 1000;
        minInterval = Math.min(minInterval, ms);
      }
    }

    console.log(`⏰ Prochain rappel dans ${this.formatInterval(minInterval / 3600000)}`);

    await new Promise(resolve => {
      this._currentTimer = setTimeout(resolve, minInterval);
    });

    if (!this.client.isReady()) return;
    this._loop();
  }

  start() {
    if (this.client.isReady()) {
      this._loop();
    } else {
      this.client.once('clientReady', () => this._loop());
    }
  }
}

function setupAutoReminder(client) {
  const reminder = new AutoReminder(client);
  client.autoReminder = reminder;
  reminder.start();
  return reminder;
}

module.exports = { AutoReminder, setupAutoReminder };