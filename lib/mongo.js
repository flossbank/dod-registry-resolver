const { MongoClient } = require('mongodb')

const MONGO_DB = 'flossbank_db'
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
