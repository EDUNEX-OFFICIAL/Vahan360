"use strict";

const { SCRAPE_JOB_KINDS } = require("@vahan360/contracts");

/**
 * @param {unknown} value
 * @returns {value is import("@vahan360/contracts").ScrapeJobKind}
 */
function isScrapeJobKind(value) {
  return (
    typeof value === "string" &&
    /** @type {readonly string[]} */ (SCRAPE_JOB_KINDS).includes(value)
  );
}

module.exports = {
  SCRAPE_JOB_KINDS,
  isScrapeJobKind,
};
