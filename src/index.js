// src/index.js - Point d'entrée du bot PSG Dream League (Node.js)
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');

console.log('🔍 Vérification de l\'environnement...');
console.log(`📁 Dossier de travail: ${process.cwd()}`);
console.log(`🟢 Node.js version: ${process.version}`);

const { TOKEN, DATA_DIR, PACKS_DIR } = require('./config/settings');
console.log(`🔑 Token détecté: ${TOKEN.slice(0, 10)}...`);

const { setupEvents } = require('./handlers/events');
const { setupCommands } = require('./handlers/commands');

// 🔥 Minigame system (V2)
const { getNextMinigameTime, scheduleNextMinigame } = require('./utils/database');
const { spawnMinigame } = require('./commands/minigame');

// Créer les dossiers nécessaires
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PACKS_DIR, { recursive: true });
console.log('✅ Dossiers créés/vérifiés');

// Créer le client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

console.log('\n🔴🔵 Initialisation du bot PSG...');

setupEvents(client);
console.log('✅ Événements configurés');

setupCommands(client);
console.log('✅ Commandes configurées');

// ==================== 🧠 SCHEDULER MINIGAME (V2) ====================

client.once('clientReady', (client) => {
  console.log(`\n✅ Connecté en tant que ${client.user.tag}`);
  console.log('🧠 Scheduler minigame actif');

  setInterval(() => {
    const now = Date.now();

    client.guilds.cache.forEach(guild => {
      const guildId = guild.id;
      const nextTime = getNextMinigameTime(guildId);

      if (!nextTime) return;

      const timeLeft = nextTime.getTime() - now;

      // 🔥 Spawn si temps atteint
      if (timeLeft <= 0 && timeLeft > -15000) {
        console.log(`🔥 [MINIGAME] Spawn sur ${guild.name}`);

        try {
          spawnMinigame(client, guildId);
          scheduleNextMinigame(guildId);
        } catch (err) {
          console.error(`❌ Erreur spawn minigame ${guild.name}:`, err.message);
        }
      }
    });

  }, 10000); // check toutes les 10 secondes
});

// ==================== CONNEXION ====================

console.log('\n📋 Connexion à Discord...');
client.login(TOKEN).catch((error) => {
  if (error.code === 'TokenInvalid' || error.message?.includes('TOKEN_INVALID')) {
    console.error('\n❌ ERREUR DE CONNEXION: Token invalide');
    console.error('\n🔧 Solutions:');
    console.error('1. Vérifie que ton fichier .env contient bien DISCORD_TOKEN=...');
    console.error('2. Va sur https://discord.com/developers/applications');
    console.error('3. Reset ton token et copie-le dans .env');
    console.error('4. Vérifie qu\'il n\'y a pas d\'espaces avant/après le token');
  } else {
    console.error('\n❌ ERREUR INATTENDUE:', error.message);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Rejet non géré:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Exception non capturée:', error);
});

module.exports = { client };