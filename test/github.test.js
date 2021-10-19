const test = require('ava')
const sinon = require('sinon')
const nock = require('nock')
const GithubRetriever = require('../lib/github')

const log = { info: () => {}, warn: () => {} }

test.before((t) => {})

test.beforeEach((t) => {
  const ghr = new GithubRetriever({ log })
  ghr.app = {
    getInstallationAccessToken: async () => 'token'
  }
  t.context.ghr = ghr
})

test.afterEach((t) => {
  nock.cleanAll()
})

test('should filter out archived repos when retrieving org repos', async (t) => {
  const { ghr } = t.context

  nock('https://api.github.com')
    .get('/orgs/flossbank/repos')
    .reply(200, [
      { full_name: 'flossbank/cli', name: 'cli', owner: { login: 'flossbank' }, archived: false },
      { full_name: 'flossbank/splash', name: 'splash', owner: { login: 'flossbank' }, archived: false },
      { full_name: 'flossbank/ad_portal', name: 'ad_portal', owner: { login: 'flossbank' }, archived: true }
    ])

  const repos = await ghr.getOrgRepos('flossbank', 'fake-token')
  t.deepEqual(repos,
    [
      { full_name: 'flossbank/cli', name: 'cli', owner: { login: 'flossbank' }, archived: false },
      { full_name: 'flossbank/splash', name: 'splash', owner: { login: 'flossbank' }, archived: false }
    ]
  )
})

test.serial('init', async (t) => {
  const config = {
    getGithubAppConfig: sinon.stub().resolves({ id: 'abc', privateKey: 'def' })
  }
  const ghr = new GithubRetriever({ config })

  await ghr.init()

  t.true(config.getGithubAppConfig.calledOnce)
})

test.serial('getAllManifestsForOrg | invalid params', async (t) => {
  const { ghr } = t.context

  const searchPattern = {
    registry: 'npm',
    language: 'javascript',
    patterns: ['package.json']
  }

  await t.throwsAsync(
    () => ghr.getAllManifestsForOrg({ installationId: '123' }, [searchPattern]),
    { message: 'need org name, installationId, and a valid GH app to get manifests' }
  )

  await t.throwsAsync(
    () => ghr.getAllManifestsForOrg({ name: 'flossbank' }, [searchPattern]),
    { message: 'need org name, installationId, and a valid GH app to get manifests' }
  )

  ghr.app = null

  await t.throwsAsync(
    () => ghr.getAllManifestsForOrg({ name: 'flossbank', installationId: '123' }, [searchPattern]),
    { message: 'need org name, installationId, and a valid GH app to get manifests' }
  )
})

test.serial('getAllManifestsForOrg | success', async (t) => {
  const { ghr } = t.context

  const scope = nock('https://api.github.com')
    .get('/orgs/flossbank/repos')
    .reply(200, [
      { full_name: 'flossbank/cli', name: 'cli', owner: { login: 'flossbank' } },
      { full_name: 'flossbank/splash', name: 'splash', owner: { login: 'flossbank' } }
    ])
    .get('/search/code').query(true)
    .reply(200, {
      items: [
        { name: 'package.json', path: 'package.json' },
        { name: 'package-lock.json', path: 'package-lock.json' },
        { name: 'package.json', path: 'ci/tests/package.json' }
      ]
    }, { // these headers trigger the rate-limiter-avoiding logic
      'x-ratelimit-remaining': 0,
      'x-ratelimit-reset': (Date.now() + 2000) / 1000
    })
    .get('/search/code').query(true)
    .reply(200, {
      items: [
        { name: 'package.json', path: 'package.json' }
      ]
    })
    .get('/repos/flossbank/cli/contents/package.json')
    .reply(200, { content: Buffer.from('cli_package.json').toString('base64') })
    .get('/repos/flossbank/cli/contents/ci/tests/package.json')
    .reply(200, { content: Buffer.from('cli_ci_package.json').toString('base64') })
    .get('/repos/flossbank/splash/contents/package.json')
    .reply(200, { content: Buffer.from('splash_package.json').toString('base64') })

  const searchPattern = {
    registry: 'npm',
    language: 'javascript',
    patterns: ['package.json']
  }

  const manifests = await ghr.getAllManifestsForOrg({ name: 'flossbank', installationId: '123' }, [searchPattern])

  t.notThrows(() => scope.done())

  t.deepEqual(manifests, [
    {
      language: 'javascript',
      registry: 'npm',
      manifest: 'cli_package.json'
    },
    {
      language: 'javascript',
      registry: 'npm',
      manifest: 'cli_ci_package.json'
    },
    {
      language: 'javascript',
      registry: 'npm',
      manifest: 'splash_package.json'
    }
  ])
})

test.serial('getAllManifestsForOrg | bad github response to search', async (t) => {
  const { ghr } = t.context

  const scope = nock('https://api.github.com')
    .get('/orgs/flossbank/repos')
    .reply(200, [{ full_name: 'flossbank/cli', name: 'cli', owner: { login: 'flossbank' } }])
    .get('/search/code').query(true)
    .reply(200, {})

  const searchPattern = [{
    registry: 'npm',
    language: 'javascript',
    patterns: ['package.json']
  }]
  const org = {
    name: 'flossbank',
    installationId: '1234567'
  }
  const manifests = await ghr.getAllManifestsForOrg(org, searchPattern, 'token')
  t.notThrows(() => scope.done())

  t.deepEqual(manifests, [])
})

test.serial('getAllManifestsForOrg | caches', async (t) => {
  const { ghr } = t.context

  const scope = nock('https://api.github.com')
    .get('/orgs/flossbank/repos')
    .reply(200, [{ full_name: 'flossbank/cli', name: 'cli', owner: { login: 'flossbank' } }])
    .get('/search/code').query(true)
    .reply(200, {
      items: [{ name: 'package.json', path: 'package.json' }]
    })
    .get('/repos/flossbank/cli/contents/package.json')
    .reply(200, { content: Buffer.from('cli_package.json').toString('base64') })

  const searchPattern = [{
    registry: 'npm',
    language: 'javascript',
    patterns: ['package.json']
  }]
  const org = {
    name: 'flossbank',
    installationId: '1234567'
  }
  const manifestsFirst = await ghr.getAllManifestsForOrg(org, searchPattern, 'token')
  t.notThrows(() => scope.done())

  // only call made will be to download the package.json; the repos and search results are cached
  scope.get('/repos/flossbank/cli/contents/package.json')
    .reply(200, { content: Buffer.from('cli_package.json').toString('base64') })

  const manifestsSecond = await ghr.getAllManifestsForOrg(org, searchPattern, 'token')
  t.notThrows(() => scope.done())
  t.deepEqual(manifestsFirst, manifestsSecond)
})
