// src/handlers/commands.js - Routeur central des slash commands et interactions boutons/menus
const { MessageFlags } = require('discord.js');
const { logCommandUse } = require('../utils/logs');

const { soldeCommand } = require('../commands/solde');
const { packsCommand, buyPack } = require('../commands/packs');
const { collectionCommand, handleCollectionInteraction } = require('../commands/collection');
const { addCoinsCommand, removeCoinsCommand, setCoinsCommand } = require('../commands/admin');
const { giveCommand } = require('../commands/give');
const { configCommand, handleConfigInteraction } = require('../commands/config');
const { handleMinigameAnswer } = require('../commands/minigame');

function setupCommands(client) {

  client.on('interactionCreate', async (interaction) => {

    // ==================== SLASH COMMANDS ====================
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      try {
        switch (commandName) {
          case 'solde':
            await soldeCommand(interaction);
            break;

          case 'packs':
            await packsCommand(interaction);
            break;

          case 'collection': {
            const membre = interaction.options.getMember('membre') || null;
            await collectionCommand(interaction, membre);
            break;
          }

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

          case 'config':
            await configCommand(interaction);
            break;

          default:
            await interaction.reply({ content: '❌ Commande inconnue.', flags: MessageFlags.Ephemeral });
        }

        // Log toutes les commandes utilisées
        logCommandUse(interaction, commandName).catch(() => {});

      } catch (error) {
        console.error(`❌ Erreur commande /${commandName}:`, error);

        const errMsg = { content: '❌ Une erreur est survenue lors de l\'exécution de cette commande.', flags: MessageFlags.Ephemeral };
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errMsg);
          } else {
            await interaction.reply(errMsg);
          }
        } catch { /* interaction expirée */ }
      }
    }

    // ==================== BOUTONS ====================
    else if (interaction.isButton()) {
      const { customId } = interaction;

      try {
        if (customId.startsWith('buy_pack_')) {
          const parts = customId.split('_');
          const userId = parts[parts.length - 1];
          if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ Tu ne peux pas utiliser cette boutique !\n\nUtilise `/packs` pour ouvrir la tienne.', flags: MessageFlags.Ephemeral });
          }
          const packKey = parts.slice(2, parts.length - 1).join('_');
          await buyPack(interaction, packKey);
          return;
        }

        if (customId.startsWith('minigame_answer_')) {
          await handleMinigameAnswer(interaction);
          return;
        }

        if (customId.startsWith('collection_')) {
          await handleCollectionInteraction(interaction);
          return;
        }

        if (customId.startsWith('config_')) {
          await handleConfigInteraction(interaction);
          return;
        }

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
        if (customId.startsWith('collection_')) {
          await handleCollectionInteraction(interaction);
          return;
        }

        if (customId.startsWith('config_')) {
          await handleConfigInteraction(interaction);
          return;
        }

      } catch (error) {
        console.error(`❌ Erreur select menu ${interaction.customId}:`, error);
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