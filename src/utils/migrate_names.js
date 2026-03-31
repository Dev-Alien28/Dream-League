// src/utils/migrate_names.js - Migration automatique des noms au démarrage

const MIGRATION_ID = 'fix_player_names_v3';

// Toutes les variantes possibles → bon nom final
const NAME_FIXES = [
  { ancien: 'Illia Zabarnyi',  nouveau: 'Illya Zabarnyi' },
  { ancien: 'Matvey Safonov',  nouveau: 'Matveï Safonov' },
  { ancien: 'Matve\xEF Safonov', nouveau: 'Matve\xEF Safonov' }, // déjà correct, skip implicite
];

// Mapping direct id → bon nom (filet de sécurité par ID de carte)
const ID_NAME_FIXES = {
  'gk_safonov_basic':  'Matveï Safonov 25/26',
  'gk_safonov_adv':    'Matveï Safonov 25/26',
  'gk_safonov_elite':  'Matveï Safonov 25/26',
  'def_zabarnyi_basic': 'Illya Zabarnyi 25/26 Away',
  'def_zabarnyi_adv':   'Illya Zabarnyi 25/26 Away',
  'def_zabarnyi_elite': 'Illya Zabarnyi 25/26 Away',
};

async function runMigrations(users, events) {
  if (events.get(`migration_${MIGRATION_ID}`)) {
    return;
  }

  console.log(`\n🔄 Migration "${MIGRATION_ID}" en cours...`);

  let totalCardsPatched = 0;
  let totalUsersPatched = 0;

  try {
    await users.fetchEverything();

    const allEntries = [...users.entries()];
    console.log(`   📊 ${allEntries.length} entrée(s) utilisateur à analyser`);

    for (const [key, userData] of allEntries) {
      if (!Array.isArray(userData.collection) || userData.collection.length === 0) continue;

      let userPatched = false;

      userData.collection = userData.collection.map(card => {
        // Correction par ID (méthode fiable)
        if (card.id && ID_NAME_FIXES[card.id]) {
          const bonNom = ID_NAME_FIXES[card.id];
          if (card.nom !== bonNom) {
            console.log(`   ✏️  [${key}] "${card.nom}" → "${bonNom}"`);
            card.nom = bonNom;
            totalCardsPatched++;
            userPatched = true;
          }
        }
        return card;
      });

      if (userPatched) {
        users.set(key, userData);
        totalUsersPatched++;
      }
    }

    events.set(`migration_${MIGRATION_ID}`, { done: true, date: new Date().toISOString() });
    console.log(`✅ Migration terminée — ${totalUsersPatched} utilisateur(s), ${totalCardsPatched} carte(s) corrigée(s)\n`);

  } catch (err) {
    console.error(`❌ Erreur migration "${MIGRATION_ID}":`, err.message);
  }
}

module.exports = { runMigrations };