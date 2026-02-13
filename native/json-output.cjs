function formatJsonOutput(value) {
  return JSON.stringify(value === undefined ? null : value, null, 2);
}

module.exports = {
  formatJsonOutput,
};
