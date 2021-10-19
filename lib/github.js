const got = require('got')
const limit = require('call-limit')
const minimatch = require('minimatch')
const { App } = require('@octokit/app')

const getRateLimit = headers => ({
  limit: parseInt(headers['x-ratelimit-limit'], 10),
  remaining: parseInt(headers['x-ratelimit-remaining'], 10),
  reset: new Date(parseInt(headers['x-ratelimit-reset'], 10) * 1000)
})

async function sleepUntil (date) {
  return new Promise((resolve) => {
    const now = Date.now()
    const then = date.getTime()
    if (now >= then) return resolve()

    setTimeout(() => resolve(), then - now)
  })
}

async function sleepFor (seconds) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), seconds * 1000)
  })
}

class GithubRetriever {
  constructor ({ log, config }) {
    this.log = log
    this.got = got.extend({
      prefixUrl: 'https://api.github.com',
      headers: {
        accept: 'application/vnd.github.v3+json',
        'user-agent': 'flossbank/distribute-org-donations'
      },
      responseType: 'json',
      handlers: [
        (options, next) => {
          // Auth
          if (options.token && !options.headers.authorization) {
            options.headers.authorization = `token ${options.token}`
          }
          // options.json -> options.json
          options.json = options.body
          delete options.body

          return next(options)
        }
      ],
      hooks: {
        init: [
          options => {
            if (typeof options.url === 'string' && options.url.startsWith('/')) {
              options.url = options.url.slice(1)
            }
          }
        ],
        afterResponse: [
          async (response) => {
            const rateLimits = getRateLimit(response.headers)

            // we sleep even though we have a few requests remaining,
            // because if we use them all up and then sleep and then
            // make another request, there's a chance that GitHub servers
            // haven't yet "realized" that our rate limit has been reset
            // and we'll get a very nasty 403. having the extra requests
            // in our pocket means GitHub should have a chance to propagate
            // our new limits.
            if (rateLimits && rateLimits.remaining <= 5) {
              this.log.warn('Rate limited; continuing at %d (%s)', rateLimits.reset.getTime(), rateLimits.reset.toString())
              await sleepUntil(rateLimits.reset)
            }

            // Even if we aren't rate limited or out of requests, sleep for 3/4 of a second between calls
            // so that we don't get a 403 due to GitHub's rate limit policy.
            // They limit to 5k reqs / hour, which is about 83 per minute, so if we wait .75 seconds
            // we should avoid that 403. 60/.75=80
            // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting
            await sleepFor(0.75)

            return response
          }
        ]
      }
    })

    this.cache = new Map()
    this.fetchFile = limit.promise(this.fetchFileFromRepo, 30) // limit to 30 concurrent downloads

    this.config = config
    this.app = null // needs init()
  }

  async init () {
    const { privateKey, id } = await this.config.getGithubAppConfig()
    this.app = new App({ id, privateKey })
  }

  // manifestSearchPatterns: [
  //   { registry, language, patterns } => [{ registry, language, manifest }, ...]
  // ]
  async getAllManifestsForOrg (org, manifestSearchPatterns) {
    const { name, installationId } = org
    if (!name || !installationId || !this.app) {
      throw new Error('need org name, installationId, and a valid GH app to get manifests')
    }
    const token = await this.app.getInstallationAccessToken({ installationId })

    const repos = await this.getOrgRepos(name, token)

    const manifests = []
    for (const pattern of manifestSearchPatterns) {
      const manifest = await this.getManifestsFromRepos(repos, pattern, token)
      manifests.push(manifest)
    }

    this.log.info('Found %d manifest files in %s', manifests.length, name)

    return manifests.flat()
  }

  async getManifestsFromRepos (repos, manifestSearchPattern, token) {
    const manifests = []
    for (const repo of repos) {
      const { registry, language, patterns } = manifestSearchPattern
      for (const pattern of patterns) {
        const searchResults = await this.searchForManifests(repo, { registry, language, pattern }, token)
        for (const file of searchResults) {
          const manifest = await this.fetchFile(repo, file, token)
          manifests.push({ registry, language, manifest })
        }
      }
    }

    return manifests
  }

  async getOrgRepos (org, token) {
    const cacheKey = `repos_${org}`
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)
    }

    const options = {
      pagination: {
        filter: (item) => {
          // Repo's have an "archived" key on them in api v3 https://developer.github.com/v3/repos/
          // We don't want to distribute donations or count deps for any archived repositories.
          return !item.archived
        }
      },
      token
    }

    this.log.info('Getting repos for %s', org)
    // It's possible at some point in the future, github api https://developer.github.com/v3/repos/
    // will allow us to filter for non archived repos during the request. Until then, we'll fetch all
    // repos and filter the pagination response.
    const repos = await this.got.paginate.all(`orgs/${org}/repos`, options)

    this.cache.set(cacheKey, repos)

    return repos
  }

  async searchForManifests (repo, searchPattern, token) {
    const { registry, language, pattern } = searchPattern
    const cacheKey = `${repo.full_name}_${registry}_${language}`
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)
    }

    const options = {
      searchParams: { q: `filename:${pattern} path:/ repo:${repo.full_name}` },
      pagination: {
        transform: async ({ body }) => {
          // filter out partial matches (e.g. package-lock.json)
          const files = (body.items || []).filter(file => minimatch(file.name, pattern))
          return files
        }
      },
      token
    }

    this.log.info('Searching for %s/%s manifests in %s', language, registry, repo.full_name)
    const searchResults = await this.got.paginate.all('search/code', options)
    this.cache.set(cacheKey, searchResults)

    return searchResults
  }

  async fetchFileFromRepo (repo, file, token) {
    this.log.info('Fetching %s from %s', file.path, repo.full_name)
    const { path } = file
    const { body } = await this.got.get(`repos/${repo.owner.login}/${repo.name}/contents/${path}`, { token })
    const contents = Buffer.from(body.content, 'base64').toString('utf8')
    return contents
  }
}

module.exports = GithubRetriever
