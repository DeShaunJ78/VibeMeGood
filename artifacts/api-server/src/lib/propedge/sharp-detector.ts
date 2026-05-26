/**
 * Sharp money detector — identifies reverse line movement on pick'em props.
 *
 * Line move semantics:
 *   moveDirection = "up"   → line VALUE went up (29.0 → 29.5)
 *                            = heavy OVER action, book raised the bar
 *   moveDirection = "down" → line VALUE went down (29.5 → 29.0)
 *                            = heavy UNDER action, book lowered the bar
 *
 * Sharp signal = REVERSE LINE MOVEMENT:
 *   most books moved "up" (public on Over) → one book moved "down" quickly
 *   = sharp money hammering UNDER against the public  ⚡
 */

export interface RawLineMoveEvent {
  id: number;
  ppLineId: number | null;
  bookName: string | null;
  prevLine: string | null;
  newLine: string | null;
  moveSize: string | null;
  moveDirection: string | null;
  capturedAt: Date | null;
}

export interface SharpDetectionResult {
  signal: "sharp" | "public" | "neutral";
  confidence: "low" | "medium" | "high";
  explanation: string;
  /** Estimated % of betting action on the dominant (public) side 0-100 */
  estimatedPublicPct: number;
  /** Side the sharp money is on (only set when signal === "sharp") */
  sharpSide: "over" | "under" | null;
  /** Approximate public side when signal === "public" */
  publicSide: "over" | "under" | null;
}

function neutral(reason: string): SharpDetectionResult {
  return {
    signal: "neutral",
    confidence: "low",
    explanation: reason,
    estimatedPublicPct: 50,
    sharpSide: null,
    publicSide: null,
  };
}

/** Core detection function — takes the moves for a single ppLineId. */
export function detectSharpMoney(moves: RawLineMoveEvent[]): SharpDetectionResult {
  if (moves.length < 2) return neutral("Insufficient data — fewer than 2 line moves.");

  const upMoves   = moves.filter(m => m.moveDirection === "up");
  const downMoves = moves.filter(m => m.moveDirection === "down");
  const total     = moves.length;

  const upRatio   = upMoves.length   / total;
  const downRatio = downMoves.length / total;

  // Too even to determine consensus — call it neutral
  if (Math.abs(upRatio - downRatio) < 0.15) {
    return neutral("Mixed signals — up/down moves roughly equal. No clear consensus.");
  }

  const publicDir  = upRatio > downRatio ? "up"   : "down";
  const sharpDir   = publicDir === "up"  ? "down" : "up";
  const publicSide = publicDir === "up"  ? "over" : "under";
  const sharpSide  = sharpDir  === "up"  ? "over" : "under";

  const sharpMoves  = publicDir === "up" ? downMoves : upMoves;
  const publicMoves = publicDir === "up" ? upMoves   : downMoves;

  // Public concentration percentage (estimated)
  const publicPct = Math.round(Math.max(upRatio, downRatio) * 100);

  if (sharpMoves.length === 0) {
    // Pure consensus — public steam
    return {
      signal: "public",
      confidence: publicPct >= 80 ? "high" : publicPct >= 65 ? "medium" : "low",
      explanation:
        `📊 Public steam — ${publicPct}% of book moves toward ${publicSide}. ` +
        `Line moved with consensus. No reverse line movement detected.`,
      estimatedPublicPct: publicPct,
      sharpSide: null,
      publicSide,
    };
  }

  // There is at least one minority-direction (potential sharp) move
  const maxSharpSize  = Math.max(...sharpMoves.map(m => Math.abs(Number(m.moveSize ?? 0))));
  const maxPublicSize = Math.max(...publicMoves.map(m => Math.abs(Number(m.moveSize ?? 0))));

  // Velocity: sharp moves that happened within last 30 min
  const now = Date.now();
  const recentSharpMoves = sharpMoves.filter(m => {
    if (!m.capturedAt) return false;
    const ageMins = (now - new Date(m.capturedAt).getTime()) / 60000;
    return ageMins < 30;
  });

  // Timing: early action (> 2h before now = sharps, late = public)
  const allCapturedAts = moves
    .filter(m => m.capturedAt != null)
    .map(m => new Date(m.capturedAt!).getTime());
  const earliestMoveAge = (now - Math.min(...allCapturedAts)) / 60000; // minutes
  const hasEarlyAction  = earliestMoveAge > 120; // moves captured > 2 hours ago

  // Multiple books moving simultaneously = books balancing, not sharp
  const uniqueBooks = new Set(moves.map(m => m.bookName)).size;
  const booksMovingTogether = uniqueBooks >= 3 && publicPct >= 80;

  // --- Confidence scoring ---
  let confidence: "low" | "medium" | "high" = "low";

  if (
    maxSharpSize >= 0.5     &&   // meaningful move size (0.5+ line units, e.g. 25.5 → 26.0)
    recentSharpMoves.length > 0 &&
    publicPct >= 65         &&
    !booksMovingTogether
  ) {
    confidence = "high";
  } else if (
    maxSharpSize >= 0.25    &&
    publicPct >= 60         &&
    sharpMoves.length >= 1
  ) {
    confidence = "medium";
  }

  if (confidence === "low" && sharpMoves.length < 2 && maxSharpSize < 0.25) {
    return neutral("Minor divergence — move size too small to confirm sharp action.");
  }

  // Down-grade if books all moved together (public balancing, not sharp)
  if (booksMovingTogether && confidence === "high") confidence = "medium";

  const earlyNote   = hasEarlyAction ? " Early-market action (sharp bettors move first)." : "";
  const velocityNote = recentSharpMoves.length > 0 ? " Quick move in last 30 min." : "";

  const explanation =
    confidence === "high"
      ? `⚡ Sharp signal — UNDER pressure: ${publicPct}% of book moves went toward ${publicSide} ` +
        `but the line moved ${maxSharpSize.toFixed(2)} units toward ${sharpSide} (reverse line movement).` +
        earlyNote + velocityNote
      : confidence === "medium"
      ? `⚡ Possible sharp ${sharpSide} interest — ${maxSharpSize.toFixed(2)}-unit reverse move against ` +
        `${publicPct}% public consensus.${earlyNote}`
      : `Weak sharp hint on ${sharpSide} — minor reverse line movement (${maxSharpSize.toFixed(2)} units). ` +
        `Watch for confirmation.`;

  return {
    signal: "sharp",
    confidence,
    explanation,
    estimatedPublicPct: 100 - publicPct,
    sharpSide,
    publicSide,
  };
}

/**
 * Batch detection — runs detection for each ppLineId group.
 * Returns a map from ppLineId → SharpDetectionResult.
 */
export function detectAllSharpSignals(
  moves: RawLineMoveEvent[],
): Map<number, SharpDetectionResult> {
  const byPpLineId = new Map<number, RawLineMoveEvent[]>();
  for (const m of moves) {
    const id = m.ppLineId;
    if (id === null) continue;
    if (!byPpLineId.has(id)) byPpLineId.set(id, []);
    byPpLineId.get(id)!.push(m);
  }

  const results = new Map<number, SharpDetectionResult>();
  for (const [id, group] of byPpLineId) {
    results.set(id, detectSharpMoney(group));
  }
  return results;
}
