const { MongoClient, ObjectId } = require('mongodb')
const ULID = require('ulid')

const MONGO_DB = 'flossbank_db'
const PACKAGES_COLLECTION = 'packages'
const ORGS_COLLECTION = 'organizations'
const META_COLLECTION = 'meta'
const NO_COMP_LIST = 'noCompList'

class Mongo {
  constructor ({ config, log }) {
    this.log = log
    this.config = config
    this.db = null
    this.mongoClient = null
  }

  async connect () {
    const mongoUri = await this.config.getMongoUri()
    this.mongoClient = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    })
    await this.mongoClient.connect()

    this.db = this.mongoClient.db(MONGO_DB)
  }

  async close () {
    if (this.mongoClient) return this.mongoClient.close()
  }

  async getPackage ({ packageId }) {
    this.log.info('Retrieving package from DB', packageId)

    const pkg = await this.db.collection(PACKAGES_COLLECTION).findOne({
      _id: ObjectId(packageId)
    })

    if (!pkg) return pkg

    const { name, language, registry } = pkg

    return { name, language, registry }
  }

  async getOrg ({ organizationId }) {
    this.log.info('Retrieving org from DB', organizationId)

    const org = await this.db.collection(ORGS_COLLECTION).findOne({
      _id: ObjectId(organizationId)
    })

    if (!org) return org

    const { name, host, installationId } = org

    return { name, host, installationId }
  }

  async distributeOrgDonation ({ donationAmount, packageWeightsMap, language, registry, organizationId, description }) {
    // if there are no weights in the map, this suggests we found no supported package manifest files
    // in the organization's repos for this language and registry
    if (!packageWeightsMap.size) {
      return
    }

    this.log.info('Distributing invoice: %s', description)
    this.log.info('Distributing %d to %d packages for language: %s, registry: %s', donationAmount, packageWeightsMap.size, language, registry)

    const bulkUpdates = this.db.collection(PACKAGES_COLLECTION).initializeUnorderedBulkOp()
    for (const [pkg, weight] of packageWeightsMap) {
      const packageShareOfDonation = weight * donationAmount
      bulkUpdates.find({ registry, language, name: pkg }).upsert().updateOne({
        $push: {
          donationRevenue: {
            description,
            organizationId,
            amount: packageShareOfDonation,
            timestamp: Date.now(),
            id: ULID.ulid()
          }
        }
      })
    }
    return bulkUpdates.execute()
  }

  async updateDonatedAmount ({ organizationId, amount }) {
    return this.db.collection(ORGS_COLLECTION).updateOne({
      _id: ObjectId(organizationId)
    }, {
      $inc: {
        totalDonated: amount
      }
    })
  }

  async decrimentManuallyBilledOrgRemainingDonation ({ organizationId, amount }) {
    return this.db.collection(ORGS_COLLECTION).updateOne({
      _id: ObjectId(organizationId)
    }, {
      $inc: {
        remainingDonation: -amount
      }
    })
  }

  async createOrganizationOssUsageSnapshot ({ totalDependencies, topLevelDependencies, organizationId }) {
    return this.db.collection(ORGS_COLLECTION).updateOne({
      _id: ObjectId(organizationId)
    }, {
      $push: {
        snapshots: { timestamp: Date.now(), totalDependencies, topLevelDependencies }
      }
    })
  }

  async getNoCompList ({ language, registry }) {
    const noCompList = await this.db.collection(META_COLLECTION).findOne({
      name: NO_COMP_LIST,
      language,
      registry
    })
    if (!noCompList || !noCompList.list) {
      return new Set()
    }
    return new Set(noCompList.list)
  }
}

module.exports = Mongo
