// src/handlers/commands.js - Routeur central des slash commands et interactions — V4
const { MessageFlags } = require('discord.js');
const { logCommandUse } = require('../utils/logs');
const { rappelCommand } = require('../commands/rappel');

const { addCoinsCommand, removeCoinsCommand, setCoinsCommand, removeCardCommand, handleRemoveCardInteraction } = require('../commands/admin');
const { giveCommand } = require('../commands/give');
const { configCommand, handleConfigInteraction } = require('../commands/config');
const { handleMinigameAnswer } = require('../commands/minigame');
const { statsCommand, handleStatsRefresh } = require('../commands/stats');
const { transfertCommand, handleTransfertInteraction } = require('../commands/transfert');
const { simMatchesCommand } = require('../commands/simmatches');
const { statsMatchCommand, handleStatsMatchInteraction } = require('../commands/statsmatch');
const {
  handleBoosters,
  handleBuyPack,
  handlePortefeuille,
  handleCollection,
  handleCollectionInteraction,
} = require('../commands/gaming_room');
const { sendTeamRoomEmbed, handleEquipe, handleSoon, handleTeamInteraction } = require('../commands/team');
const { handleMatch, handleMatchInteraction } = require('../commands/match');

function setupCommands(client) {

  client.on('interactionCreate', async (interaction) => {

    // ==================== SLASH COMMANDS ====================
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      try {
        switch (commandName) {
          case 'addcoins': {
            const membre  = interaction.options.getMember('membre');
            const montant = interaction.options.getInteger('montant');
            await addCoinsCommand(interaction, membre, montant);
            break;
          }
          case 'removecoins': {
            const membre  = interaction.options.getMember('membre');
            const montant = interaction.options.getInteger('montant');
            await removeCoinsCommand(interaction, membre, montant);
            break;
          }
          case 'setcoins': {
            const membre  = interaction.options.getMember('membre');
            const montant = interaction.options.getInteger('montant');
            await setCoinsCommand(interaction, membre, montant);
            break;
          }
          case 'give': {
            const carteId = interaction.options.getString('carte_id');
            const membre  = interaction.options.getMember('membre');
            const raison  = interaction.options.getString('raison') || null;
            await giveCommand(interaction, carteId, membre, raison);
            break;
          }
          case 'removecard': {
            const membre = interaction.options.getMember('membre');
            await removeCardCommand(interaction, membre);
            break;
          }
          case 'config':
            await configCommand(interaction);
            break;
          case 'rappel':
            await rappelCommand(interaction);
            break;
          case 'stats':
            await statsCommand(interaction);
            break;
          case 'transfert':
            await transfertCommand(interaction);
            break;
          case 'simmatches':
            await simMatchesCommand(interaction);
            break;
          case 'statsmatch':
            await statsMatchCommand(interaction);
            break;
          default:
            await interaction.reply({ content: '❌ Commande inconnue.', flags: MessageFlags.Ephemeral });
        }

        logCommandUse(interaction, commandName).catch(() => {});

      } catch (error) {
        console.error(`❌ Erreur commande /${commandName}:`, error);
        const errMsg = { content: "❌ Une erreur est survenue lors de l'exécution de cette commande.", flags: MessageFlags.Ephemeral };
        try {
          if (interaction.replied || interaction.deferred) await interaction.followUp(errMsg);
          else await interaction.reply(errMsg);
        } catch { /* expirée */ }
      }
    }

    // ==================== MODALS ====================
    // ⚠️ IMPORTANT : isModalSubmit() doit être vérifié AVANT isButton() et isStringSelectMenu()
    // car showModal() est une réponse directe — ne jamais defer avant d'ouvrir un modal.
    else if (interaction.isModalSubmit()) {
      const { customId } = interaction;

      try {
        if (customId === 'config_enc_modal_submit') {
          await handleConfigInteraction(interaction);
          return;
        }
      } catch (error) {
        console.error(`❌ Erreur modal ${customId}:`, error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    }

    // ==================== BOUTONS ====================
    else if (interaction.isButton()) {
      const { customId } = interaction;

      try {
        // ── Admin ──
        if (customId.startsWith('admin_removecard_')) {
          await handleRemoveCardInteraction(interaction);
          return;
        }

        // ── Stats ──
        if (customId.startsWith('stats_refresh_')) {
          await handleStatsRefresh(interaction);
          return;
        }

        // ── Stats Match ──
        if (customId.startsWith('statsmatch_')) {
          await handleStatsMatchInteraction(interaction);
          return;
        }

        // ── Transfert ──
        if (customId.startsWith('transfert_')) {
          await handleTransfertInteraction(interaction);
          return;
        }

        // ── Gaming Room ──
        if (customId === 'gr_boosters') {
          await handleBoosters(interaction);
          return;
        }
        if (customId === 'gr_collection') {
          await handleCollection(interaction);
          return;
        }
        if (customId === 'gr_portefeuille') {
          await handlePortefeuille(interaction);
          return;
        }

        // ── Team Room ──
        if (customId === 'tr_equipe') {
          await handleEquipe(interaction);
          return;
        }
        if (customId === 'tr_match') {
          await handleMatch(interaction);
          return;
        }
        if (customId === 'tr_soon') {
          await handleSoon(interaction);
          return;
        }
        if (customId.startsWith('tr_')) {
          await handleTeamInteraction(interaction);
          return;
        }

        // ── Match — FIX v4.1 : pen_tir_ et pen_gk_ remplacent pen_side_ ──
        if (
          customId.startsWith('match_accept_')      ||
          customId.startsWith('match_refuse_')      ||
          customId.startsWith('match_ready_')       ||
          customId.startsWith('match_pause_ready_') ||
          customId.startsWith('match_sub_')         ||
          customId.startsWith('pen_tir_')           ||
          customId.startsWith('pen_gk_')
        ) {
          await handleMatchInteraction(interaction);
          return;
        }

        // ── Achat de pack ──
        if (customId.startsWith('gr_buy_pack_')) {
          const parts  = customId.split('_');
          const userId = parts[parts.length - 1];
          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: '❌ Ouvre ta propre boutique en cliquant sur **Les Boosters** !',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const packKey = parts.slice(3, parts.length - 1).join('_');
          await handleBuyPack(interaction, packKey);
          return;
        }

        // ── Collection ──
        if (customId.startsWith('gr_coll_')) {
          await handleCollectionInteraction(interaction);
          return;
        }

        // ── Minigame / Encounter ──
        if (customId.startsWith('encounter_answer_') || customId.startsWith('minigame_answer_')) {
          await handleMinigameAnswer(interaction);
          return;
        }

        // ── Config ──
        // ⚠️ config_enc_modal_open appelle showModal() — ne jamais defer avant
        if (customId.startsWith('config_')) {
          await handleConfigInteraction(interaction);
          return;
        }

      } catch (error) {
        console.error(`❌ Erreur bouton ${customId}:`, error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ Une erreur est survenue.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }
    }

    // ==================== SELECT MENUS ====================
    else if (interaction.isStringSelectMenu()) {
      const { customId } = interaction;

      try {
        if (customId.startsWith('admin_removecard_')) { await handleRemoveCardInteraction(interaction); return; }
        if (customId.startsWith('gr_coll_'))          { await handleCollectionInteraction(interaction); return; }
        if (customId.startsWith('config_'))           { await handleConfigInteraction(interaction); return; }
        if (customId.startsWith('tr_'))               { await handleTeamInteraction(interaction); return; }
        if (customId.startsWith('match_'))            { await handleMatchInteraction(interaction); return; }

      } catch (error) {
        console.error(`❌ Erreur select menu ${customId}:`, error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ Une erreur est survenue.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }
    }

    // ==================== USER SELECT MENU ====================
    else if (interaction.isUserSelectMenu()) {
      const { customId } = interaction;

      try {
        if (customId.startsWith('statsmatch_select_player_'))    { await handleStatsMatchInteraction(interaction); return; }
        if (customId.startsWith('gr_coll_user_select_'))         { await handleCollectionInteraction(interaction); return; }
        if (customId.startsWith('tr_view_team_other_'))          { await handleTeamInteraction(interaction); return; }
        if (customId.startsWith('match_select_opponent_'))       { await handleMatchInteraction(interaction); return; }

      } catch (error) {
        console.error(`❌ Erreur user select menu ${interaction.customId}:`, error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ Une erreur est survenue.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }
    }
  });
}

module.exports = { setupCommands };