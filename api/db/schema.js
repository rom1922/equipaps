import { mysqlTable, varchar, text, datetime, int, boolean } from "drizzle-orm/mysql-core";

export const events = mysqlTable("events", {
  id: varchar("id", { length: 16 }).notNull().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  date: datetime("date").notNull(),
  paps: datetime("paps").notNull(),
  location: varchar("location", { length: 255 }).notNull(),
  participants: int("participants").notNull().default(0),
  closed: boolean("closed").notNull().default(false),
  description: text("description"),
});

export const paps = mysqlTable("paps", {
  id: int("id").notNull().autoincrement().primaryKey(),
  eid: varchar("eid", { length: 16 }).notNull().references(() => events.id),
  pxx: varchar("pxx", { length: 10 }).notNull(),
  date: datetime("date").notNull(),
});

export const users = mysqlTable("users", {
  id: varchar("id", { length: 16 }).notNull().primaryKey(),
  pxx: varchar("pxx", { length: 10 }),
});

export const resultats = mysqlTable("resultats", {
  id: int("id").notNull().autoincrement().primaryKey(),
  eid: varchar("eid", { length: 16 }).notNull().references(() => events.id),
  pxx: varchar("pxx", { length: 10 }).notNull(),
});

export const hpaps = mysqlTable("hpaps", {
  id: int("id").notNull().autoincrement().primaryKey(),
  eid: varchar("eid", { length: 16 }).notNull().references(() => events.id),
  pxx: varchar("pxx", { length: 10 }).notNull(),
  date: datetime("date").notNull(),
});

// Roster : base élèves factorisée depuis l'annuaire Pain de Mine (mineurs.json),
// synchronisée en lecture seule (PDM reste le mainteneur). Remplace users.txt.
// Clé = login portail `pxx` (varchar(10)), la MÊME identité que paps/hpaps/
// resultats/users : les logins existants sont préservés verbatim (parité de
// l'historique), les nouveaux (dont la promo 26) reçoivent un pxx dérivé unique.
// Une rangée sans nom (prenom/nom NULL) est un login legacy conservé pour son
// historique et son statut cotisant, non exposé à la recherche par nom.
export const roster = mysqlTable("roster", {
  pxx: varchar("pxx", { length: 10 }).notNull().primaryKey(),
  prenom: varchar("prenom", { length: 128 }),
  nom: varchar("nom", { length: 128 }),
  email: varchar("email", { length: 255 }),
  promo: varchar("promo", { length: 8 }),
  photo_url: varchar("photo_url", { length: 512 }),
  search_key: varchar("search_key", { length: 255 }),
  cotisant: boolean("cotisant").notNull().default(false),
  source_id: varchar("source_id", { length: 16 }),
  synced_at: datetime("synced_at"),
});