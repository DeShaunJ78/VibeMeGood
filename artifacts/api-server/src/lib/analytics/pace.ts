export interface GameLog {
  fga: number;
  fta: number;
  oreb: number;
  tov: number;
  minutes: number;
}

export function computePossessions(log: GameLog): number {
  return log.fga + 0.44 * log.fta - log.oreb + log.tov;
}

export function computeTeamPace(gameLogs: GameLog[]): number {
  if (gameLogs.length === 0) return 100.0;
  let totalPossessions = 0;
  let totalMinutes = 0;
  for (const log of gameLogs) {
    totalPossessions += computePossessions(log);
    totalMinutes += log.minutes;
  }
  if (totalMinutes === 0) return 100.0;
  return (totalPossessions / totalMinutes) * 48;
}

export function computeGamePace(team1Pace: number, team2Pace: number): number {
  return (team1Pace + team2Pace) / 2;
}

export function getPaceLabel(pace: number): string {
  if (pace > 105) return "Elite pace";
  if (pace >= 102) return "Fast pace";
  if (pace >= 98)  return "Average pace";
  if (pace >= 95)  return "Slow pace";
  return "Very slow pace";
}

export function getPaceAdjustment(pace: number): number {
  if (pace > 105) return 0.06;
  if (pace >= 102) return 0.03;
  if (pace >= 98)  return 0.00;
  if (pace >= 95)  return -0.03;
  return -0.06;
}

export function getPaceColor(pace: number): "fast" | "average" | "slow" {
  if (pace > 102) return "fast";
  if (pace >= 98) return "average";
  return "slow";
}

export interface GamePaceResult {
  estimatedGamePace: number;
  paceLabel: string;
  paceAdjustment: number;
  paceColor: "fast" | "average" | "slow";
}

export function buildGamePaceResult(team1Pace: number, team2Pace: number): GamePaceResult {
  const estimatedGamePace = computeGamePace(team1Pace, team2Pace);
  return {
    estimatedGamePace: Math.round(estimatedGamePace * 10) / 10,
    paceLabel: getPaceLabel(estimatedGamePace),
    paceAdjustment: getPaceAdjustment(estimatedGamePace),
    paceColor: getPaceColor(estimatedGamePace),
  };
}

// Realistic 2024-25 NBA team pace ratings (possessions per 48 min)
// Source: estimated from known season pace rankings
export const NBA_2025_SEED_PACE: Record<string, number> = {
  MEM: 106.2,  // Memphis Grizzlies — elite pace, league fastest
  WAS: 104.9,  // Washington Wizards — fast, high tempo
  CHA: 104.5,  // Charlotte Hornets — fast pace
  ATL: 103.8,  // Atlanta Hawks — up-tempo
  SAS: 103.2,  // San Antonio Spurs — fast under new regime
  GSW: 102.7,  // Golden State Warriors — historically fast
  NOP: 102.1,  // New Orleans Pelicans
  MIN: 101.8,  // Minnesota Timberwolves
  OKC: 101.5,  // Oklahoma City Thunder
  DEN: 101.3,  // Denver Nuggets
  PHX: 100.8,  // Phoenix Suns
  UTA: 100.5,  // Utah Jazz
  MIL: 100.1,  // Milwaukee Bucks
  BOS: 100.0,  // Boston Celtics — methodical
  DAL: 99.8,   // Dallas Mavericks
  LAC: 99.5,   // LA Clippers
  SAC: 99.4,   // Sacramento Kings
  TOR: 99.2,   // Toronto Raptors
  BKN: 99.0,   // Brooklyn Nets
  LAL: 98.9,   // Los Angeles Lakers
  IND: 98.7,   // Indiana Pacers
  POR: 98.6,   // Portland Trail Blazers
  HOU: 98.5,   // Houston Rockets
  CLE: 98.3,   // Cleveland Cavaliers — slow, methodical
  PHI: 98.1,   // Philadelphia 76ers
  CHI: 97.9,   // Chicago Bulls
  MIA: 97.5,   // Miami Heat — very slow, defensive
  DET: 97.2,   // Detroit Pistons
  NYK: 97.0,   // New York Knicks — slow, grind it out
  ORL: 96.8,   // Orlando Magic — defensive, slow
};
