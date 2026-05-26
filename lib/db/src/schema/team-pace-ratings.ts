import { pgTable, serial, text, numeric, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const teamPaceRatingsTable = pgTable("team_pace_ratings", {
  id:               serial("id").primaryKey(),
  teamName:         text("team_name").notNull(),
  teamAbbr:         text("team_abbr").notNull(),
  sport:            text("sport").notNull(),
  season:           text("season").notNull(),
  paceRating:       numeric("pace_rating").notNull(),
  last10PaceRating: numeric("last10_pace_rating"),
  homeAwayPaceAdj:  numeric("home_away_pace_adj").default("0"),
  gamesComputed:    integer("games_computed").default(0),
  computedAt:       timestamp("computed_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("team_pace_ratings_uniq").on(t.teamAbbr, t.sport, t.season),
}));

export type TeamPaceRating = typeof teamPaceRatingsTable.$inferSelect;
export type InsertTeamPaceRating = typeof teamPaceRatingsTable.$inferInsert;
