const Promise = require("bluebird")
const chalk = require('chalk')
const yargs = require('yargs/yargs')
const yaml = require('js-yaml')
const fse = require('fs-extra')

function parseCmd() {
  const argv = yargs(process.argv.slice(2))
        .usage('Usage: $0 -i chainSpec.json -o chainSpecOut.json -n nodeSpec1.yaml -n nodeSpec2.yaml')
        .alias('i', 'input')
        .describe('i', 'input chain config')
        .alias('o', 'output')
        .describe('o', 'output chain config')
        .alias('n', 'node')
        .describe('n', 'node config file')
        .demandOption(['o', 'i', 'n'])
        .string(['i', 'o', 'n'])
        .array('n')
        .argv
  return argv
}

async function loadNodeSpec(spec) {
  return yaml.safeLoad(await fse.readFile(spec, 'utf8'))
}

async function main() {
  const argv = parseCmd()
  const config = await fse.readJson(argv.i)
  console.log(chalk.green(`config file: "${argv.i}" loaded`))
  const nodeSpecs = Promise.mapSeries(argv.n, async (nodeConfig) => {
    console.log(chalk.green(`loading node config: "${nodeConfig}"`))
    const cfg = await loadNodeSpec(nodeConfig)
    console.log(chalk.blue(`node config loaded, node id is: ${cfg.node.id}`))
  })
}

main()
