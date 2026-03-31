// src/utils/migrate_names.js - Migration automatique des noms au démarrage
// Tournera une seule fois puis se désactivera via un flag en BDD

const MIGRATION_ID = 'fix_player_names_v1';

const NAME_FIXES = [
  { ancien: 'Illia Zabarnyi',  nouveau: 'Illya Zabarnyi' },
  { ancien: 'Matvey Safonov',  nouveau: 'Matveï Safonov' },
];

async function runMigrations(users, events) {
  // Vérifier si cette migration a déjà été faite
  if (events.get(`migration_${MIGRATION_ID}`)) {
    console.log(`✅ Migration "${MIGRATION_ID}" déjà appliquée, skip.`);
    return;
  }

  console.log(`\n🔄 Migration "${MIGRATION_ID}" en cours...`);

  let totalCardsPatched = 0;
  let totalUsersPatched = 0;

  const allEntries = users.entries ? [...users.entries()] : [...users];

  for (const [key, userData] of allEntries) {
    if (!Array.isArray(userData.collection) || userData.collection.length === 0) continue;

    let userPatched = false;

    userData.collection = userData.collection.map(card => {
      for (const fix of NAME_FIXES) {
        if (card.nom && card.nom.includes(fix.ancien)) {
          card.nom = card.nom.replace(fix.ancien, fix.nouveau);
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

  // Marquer la migration comme faite
  events.set(`migration_${MIGRATION_ID}`, { done: true, date: new Date().toISOString() });

  console.log(`✅ Migration terminée — ${totalUsersPatched} utilisateur(s), ${totalCardsPatched} carte(s) corrigée(s)\n`);
}

module.exports = { runMigrations };