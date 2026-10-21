/* ============================================================
   étude — errors
   ============================================================ */

/** A mistake in étude code, with the 1-based line it's on. */
export class EtudeError extends Error {
  /** @param {string} message @param {number} line */
  constructor(message, line) {
    super(message);
    this.name = "EtudeError";
    this.line = line;
  }
}
