const { execSync } = require('child_process');

module.exports = (file, options) => {
  try {
    execSync(`grainc ${file}`);
    return file.replace(/\.gr$/, '.wasm')
  } catch (e) {
    console.log(e.stdout.toString());
    if (options.graceful) {
      process.exit()
    } else {
      process.exit(-1)
    }
  }
}
