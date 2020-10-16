const Promise = require("bluebird")
const chalk = require('chalk')
const yargs = require('yargs/yargs')
const yaml = require('js-yaml')
const fse = require('fs-extra')
const _ = require('lodash')
const { u8aToHex } = require('@polkadot/util')
const { cryptoWaitReady } = require('@polkadot/util-crypto')
const { Keyring } = require('@polkadot/keyring')

let keyring = null
let keyringSr25519 = null

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
  bootnodes: updateBootNodes,
  naming: updateNaming,
  balance: updateBalances,
  tokens: updateTokens,
  session: updateSession,
  sudo: updateSudo,
  staking: updateStaking,
}

async function main() {
  await cryptoWaitReady()

  keyring = new Keyring( { type: 'ed25519'})
  keyringSr25519 = new Keyring( { type: 'sr25519'})

  const argv = parseCmd()
  try {
    let config = await fse.readJson(argv.i)
    console.log(chalk.green(`config file: "${argv.i}" loaded`))
    const chainConfig = yaml.safeLoad(await fse.readFile(argv.c, 'utf8'))
    console.log(chalk.green(`chain config file: "${argv.i}" loaded`))
    _.forEach(chainSpecModifiers, (fn, name) => {
      console.log(chalk.green('updating chain config: ' +  chalk.magenta(`${name}`)))
      config = fn(config, chainConfig)
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

function loadKeyFromMemo(memo) {
  const keyEd25519 = keyring.addFromMnemonic(memo)
  const keySr25519 = keyringSr25519.addFromMnemonic(memo)
  return {
    address: keySr25519.address,
    pubKeyEd25519: u8aToHex(keyEd25519.publicKey),
    pubKeySr25519: u8aToHex(keyEd25519.publicKey),
  }
}

function updateBootNodes(config, chainConfig) {
  const bootNodes = _.map(chainConfig.nodes, (node, name) => {
    return `/dns/${node.host}/tcp/30334/p2p/${node.id}`
  })
  return {
    ...config,
    bootNodes,
  }
}

function updateNaming(config, chainConfig) {
  const { name, id, chainType } = chainConfig.meta
  return {
    ...config,
    name,
    id,
    chainType,
  }
}

function getAccountOrFail(chainConfig, accountName) {
  const account = _.get(chainConfig, ['accounts', accountName])
  if (_.isEmpty(account)) {
    throw `invalid account "${accountName}"`
  }
  const accountData = loadKeyFromMemo(account.seed)
  return {
    ...account,
    accountData,
  }
}

function updateBalances(config, chainConfig) {
  config.genesis.runtime.palletBalances.balances = _.map(chainConfig.accounts, (account) => {
    const data = loadKeyFromMemo(account.seed)
    return [
      data.address,
      account.balance
    ]
  })
  return config
}

function updateTokens(config, chainConfig) {
  config.genesis.runtime.ormlTokens.endowedAccounts = _.chain(chainConfig.accounts)
    .map((account) => {
      const data = loadKeyFromMemo(account.seed)
      return _.map(account.tokens, (amount, name) => [data.address, name, amount])
    }).flatten().value()

  return config
}

function updateSudo(config, chainConfig) {
  const sudoAccount = _.get(chainConfig, 'sudo_account', '')
  const rootAccount = getAccountOrFail(chainConfig, sudoAccount)
  const rootKey = _.chain(rootAccount).get('accountData.address');
  if (rootKey.isEmpty().value()) {
    throw `invalid sudo account "${sudoAccount}"`
  }
  config.genesis.runtime.palletSudo = {
    key: rootKey.value(),
  }

  return config
}

function updateSession(config, chainConfig) {
  config.genesis.runtime.palletSession.keys = _.map(chainConfig.nodes, (node, key) => {
    let account = getAccountOrFail(chainConfig, node.account)
    // stash, ctrl, babeid, grandpa id
    const grandpa = loadKeyFromMemo(account.grandpa.seed)
    const grandpaId = _.get(grandpa, 'address')
    const babe = loadKeyFromMemo(_.get(account, 'babe.seed'))
    const babeId = babe.address
    if (_.isEmpty(grandpaId) || _.isEmpty(babeId)) {
      throw `invalid grandpa/babe config for node: "${key}", the account is: "${node.account}"`
    }
    const address = account.accountData.address
    return [address, address,  {
      grandpa: grandpaId,
      babe: babeId,
    }]
  })

  return config
}

function updateStaking(config, chainConfig) {
  const stakingAccounts = _.chain(chainConfig.staking).filter((account) => {
    return account.role === 'Validator'
  }).map((accountData) => {
    const account = getAccountOrFail(chainConfig, accountData.stash)
    return account.accountData.address
  }).value()

  config.genesis.runtime.palletStaking.invulnerables = stakingAccounts
  config.genesis.runtime.palletStaking.validatorCount = _.max([2, _.size(stakingAccounts) * 2])
  config.genesis.runtime.palletStaking.minimumValidatorCount = _.size(stakingAccounts)
  config.genesis.runtime.palletStaking.stakers = _.map(chainConfig.staking).map((accountData, key) => {
    const stashAccount = getAccountOrFail(chainConfig, accountData.stash)
    const controllerAccount = getAccountOrFail(chainConfig, accountData.controller)
    return [
      stashAccount.accountData.address,
      controllerAccount.accountData.address,
      100000000000000, // 100 * 10^12
      accountData.role,
    ]
  })

  return config
}

main()
