// A refusal is not a crash. The scout fails closed in a way downstream lanes
// can tell apart from a bug: ScoutRefusal means "the run declined to produce a
// report, and here is what was missing", which Lane E maps to an exit code and
// Lane D reports rather than swallows.
//
// A bare Error escaping this package is a defect. A ScoutRefusal is the design.

export class ScoutRefusal extends Error {
  /**
   * @param {string} message What is missing, and where repair would start.
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ScoutRefusal";
  }
}
