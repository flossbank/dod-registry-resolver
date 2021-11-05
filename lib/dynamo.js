class Dynamo {
  constructor ({ docs }) {
    this.docs = docs
    this.CONFIG_TABLE = 'config'
  }

  async getConfigValue (configKey) {
    const { Item } = await this.docs.get({
      TableName: this.CONFIG_TABLE,
      Key: { configKey }
    }).promise()
    return (Item || {}).configValue
  }
}

module.exports = Dynamo
