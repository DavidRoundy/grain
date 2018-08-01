const { execSync } = require('child_process');

module.exports = (file) => {
  try {
    execSync(`grainc ${file}`);
    return file.replace(/\.gr$/, '.wasm')
  } catch (e) {
    console.log(e.stdout.toString());
    process.exit(-1);
  }
}
