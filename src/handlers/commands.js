// src/handlers/commands.js - Routeur central des slash commands et interactions
const { MessageFlags } = require('discord.js');
const { logCommandUse } = require('../utils/logs');
const { rappelCommand } = require('../commands/rappel');

const { addCoinsCommand, removeCoinsCommand, setCoinsCommand, removeCardCommand, handleRemoveCardInteraction } = require('../commands/admin');
const { giveCommand } = require('../commands/give');
const { configCommand, handleConfigInteraction } = require('../commands/config');
const { handleMinigameAnswer } = require('../commands/minigame');
const {
  handleBoosters,
  handleBuyPack,
  handlePortefeuille,
  handleCollection,
  handleCollectionInteraction,
} = require('../commands/gaming_room');

function setupCommands(client) {

  client.on('interactionCreate', async (interaction) => {

    // ==================== SLASH COMMANDS ====================
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      try {
        switch (commandName) {
          case 'addcoins': {
            const membre = interaction.options.getMember('membre');
            const montant = interaction.options.getInteger('montant');
            await addCoinsCommand(interaction, membre, montant);
            break;
          }
          case 'removecoins': {
            const membre = interaction.options.getMember('membre');
            const montant = interaction.options.getInteger('montant');
            await removeCoinsCommand(interaction, membre, montant);
            break;
          }
          case 'setcoins': {
            const membre = interaction.options.getMember('membre');
            const montant = interaction.options.getInteger('montant');
            await setCoinsCommand(interaction, membre, montant);
            break;
          }
          case 'give': {
            const carteId = interaction.options.getString('carte_id');
            const membre = interaction.options.getMember('membre');
            const raison = interaction.options.getString('raison') || null;
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
        // ── Config Encounter modal ──
        if (customId === 'config_enc_modal_submit') {
          await handleConfigInteraction(interaction);
          return;
        }

        // Ajoute ici d'autres modals si nécessaire
        // if (customId === 'autre_modal') { ... }

      } catch (error) {
        console.error(`❌ Erreur modal ${customId}:`, error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral });
          }
        } catch { /* expirée */ }
      }
    }

    // ==================== BOUTONS ====================
    else if (interaction.isButton()) {
      const { customId } = interaction;

      try {
        // ── Admin removecard ──
        if (customId.startsWith('admin_removecard_')) { await handleRemoveCardInteraction(interaction); return; }

        // ── Gaming Room ──
        if (customId === 'gr_boosters')     { await handleBoosters(interaction); return; }
        if (customId === 'gr_collection')   { await handleCollection(interaction); return; }
        if (customId === 'gr_portefeuille') { await handlePortefeuille(interaction); return; }

        if (customId.startsWith('gr_buy_pack_')) {
          const parts = customId.split('_');
          const userId = parts[parts.length - 1];
          if (interaction.user.id !== userId) {
            return interaction.reply({
              content: '❌ Ouvre ta propre boutique en cliquant sur **Les Boosters** !',
              flags: MessageFlags.Ephemeral,
            });
          }
          const packKey = parts.slice(3, parts.length - 1).join('_');
          try {
            await handleBuyPack(interaction, packKey);
          } catch (buyError) {
            if (buyError.code === 'UND_ERR_CONNECT_TIMEOUT' || buyError.name === 'ConnectTimeoutError') {
              console.error(`⚠️ Timeout réseau achat pack (${packKey}) pour ${userId}`);
            } else {
              console.error(`❌ Erreur achat pack (${packKey}):`, buyError);
            }
          }
          return;
        }

        if (customId.startsWith('gr_coll_')) { await handleCollectionInteraction(interaction); return; }

        // ── Minigame / Encounter ──
        if (customId.startsWith('encounter_answer_') || customId.startsWith('minigame_answer_')) {
          await handleMinigameAnswer(interaction);
          return;
        }

        // ── Config ──
        // ⚠️ Le bouton config_enc_modal_open appelle showModal() dans handleConfigInteraction.
        // Il NE FAUT PAS defer cette interaction — handleConfigInteraction gère tout en interne.
        if (customId.startsWith('config_')) { await handleConfigInteraction(interaction); return; }

      } catch (error) {
        console.error(`❌ Erreur bouton ${interaction.customId}:`, error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral });
          }
        } catch { /* ok */ }
      }
    }

    // ==================== SELECT MENUS ====================
    else if (interaction.isStringSelectMenu()) {
      const { customId } = interaction;

      try {
        // ── Admin removecard ──
        if (customId.startsWith('admin_removecard_')) { await handleRemoveCardInteraction(interaction); return; }

        if (customId.startsWith('gr_coll_'))  { await handleCollectionInteraction(interaction); return; }
        if (customId.startsWith('config_'))   { await handleConfigInteraction(interaction); return; }

      } catch (error) {
        console.error(`❌ Erreur select menu ${interaction.customId}:`, error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral });
          }
        } catch { /* ok */ }
      }
    }

    // ==================== USER SELECT MENU ====================
    else if (interaction.isUserSelectMenu()) {
      const { customId } = interaction;

      try {
        if (customId.startsWith('gr_coll_user_select_')) { await handleCollectionInteraction(interaction); return; }

      } catch (error) {
        console.error(`❌ Erreur user select menu ${interaction.customId}:`, error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral });
          }
        } catch { /* ok */ }
      }
    }
  });
}

module.exports = { setupCommands };