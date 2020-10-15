const Promise = require("bluebird")
const chalk = require('chalk')
const yargs = require('yargs/yargs')
const yaml = require('js-yaml')
const fse = require('fs-extra')
const _ = require('lodash')

function parseCmd() {
  const argv = yargs(process.argv.slice(2))
        .usage('Usage: $0 -i chainSpec.json -o chainSpecOut.json -c chainConfig.yaml')
        .alias('i', 'input')
        .describe('i', 'input chain config')
        .alias('o', 'output')
        .describe('o', 'output chain config')
        .alias('c', 'config')
        .describe('c', 'chain config file in yaml format')
        .demandOption(['o', 'i', 'c'])
        .string(['i', 'o', 'c'])
        .argv
  return argv
}

const chainSpecModifiers = {
  balance: updateBalances,
  tokens: updateTokens,
  session: updateSession,
  sudo: updateSudo,
  staking: updateStaking,
}

async function main() {
  const argv = parseCmd()
  try {
    const config = await fse.readJson(argv.i)
    console.log(chalk.green(`config file: "${argv.i}" loaded`))
    const chainConfig = yaml.safeLoad(await fse.readFile(argv.c, 'utf8'))
    console.log(chalk.green(`chain config file: "${argv.i}" loaded`))
    _.forEach(chainSpecModifiers, (fn, name) => {
      console.log(chalk.green('updating chain config: ' +  chalk.magenta(`${name}`)))
      fn(config, chainConfig)
    })

    console.log(chalk.green('done updating chain config, saving it to ' + chalk.magenta(`${argv.o}`)))
    await fse.writeJson(argv.o, config, {
      spaces: 2,
    })
  } catch(ex) {
    if (_.isString(ex)) {
      console.log(chalk.red(ex))
    } else {
      console.log(chalk.red('error executing command'), ex)
    }
  }
}

function getAccountOrFail(chainConfig, accountName) {
  const account = _.get(chainConfig, ['accounts', accountName])
  if (_.isEmpty(account)) {
    throw `invalid account "${accountName}"`
  }
  return account
}

function updateBalances(config, chainConfig) {
  config.genesis.runtime.palletBalances.balances = _.map(chainConfig.accounts, (account) => {
    return [
      account.address,
      account.balance
    ]
  })
}

function updateTokens(config, chainConfig) {
  config.genesis.runtime.ormlTokens.endowedAccounts = _.chain(chainConfig.accounts)
    .map((account) => {
      return _.map(account.tokens, (amount, name) => [account.address, name, amount])
    }).flatten().value()
}

function updateSudo(config, chainConfig) {
  const sudoAccount = _.get(chainConfig, 'sudo_account', '')
  const rootAccount = getAccountOrFail(chainConfig, sudoAccount)
  const rootKey = _.chain(rootAccount).get('address');
  if (rootKey.isEmpty().value()) {
    throw `invalid sudo account "${sudoAccount}"`
  }
  config.genesis.runtime.palletSudo = {
    key: rootKey.value(),
  }
}

function updateSession(config, chainConfig) {
  config.genesis.runtime.palletSession.keys = _.map(chainConfig.nodes, (node, key) => {
    let account = getAccountOrFail(chainConfig, node.account)
    // stash, ctrl, babeid, grandpa id
    const grandpaId = _.get(account, 'grandpa.address')
    const babeId = _.get(account, 'babe.address')
    if (_.isEmpty(grandpaId) || _.isEmpty(babeId)) {
      throw `invalid grandpa/babe config for node: "${key}", the account is: "${node.account}"`
    }
    return [account.address, account.address,  {
      grandpa: grandpaId,
      babe: babeId,
    }]
  })
}

function updateStaking(config, chainConfig) {
  const stakingAccounts = _.chain(chainConfig.staking).filter((account) => {
    return account.role === 'Validator'
  }).map((accountData) => {
    const account = getAccountOrFail(chainConfig, accountData.stash)
    return account.address
  }).value()

  config.genesis.runtime.palletStaking.invulnerables = stakingAccounts
  config.genesis.runtime.palletStaking.validatorCount = _.max([2, _.size(stakingAccounts) * 2])
  config.genesis.runtime.palletStaking.minimumValidatorCount = _.size(stakingAccounts)
  config.genesis.runtime.palletStaking.stakers = _.map(chainConfig.staking).map((accountData, key) => {
    const stashAccount = getAccountOrFail(chainConfig, accountData.stash)
    const controllerAccount = getAccountOrFail(chainConfig, accountData.controller)
    return [
      stashAccount.address,
      controllerAccount.address,
      100000000000000, // 100 * 10^12
      accountData.role,
    ]
  })
}

main()
