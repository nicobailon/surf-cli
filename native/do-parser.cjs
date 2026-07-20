const definition = require("./workflow-definition.cjs");

module.exports = {
  ALIASES: definition.ALIASES,
  PRIMARY_ARG_MAP: definition.PRIMARY_ARG_MAP,
  parseCommandLine: definition.parseCommandLine,
  parseDoCommands: definition.parseDoCommands,
  tokenize: definition.tokenize,
};
