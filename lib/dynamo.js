class Dynamo {
  constructor ({ docs }) {
    this.docs = docs
    this.LOCKS_TABLE = 'flossbank_locks'
    this.CONFIG_TABLE = 'config'
    this.LOCK_TIMEOUT = 900 * 1000 // 15mins in ms, same as max execution time of lambda
  }

  async lockOrg ({ organizationId }) {
    // get lock info from flossbank_lambda_locks table
    // and lock on the user id for processing
    try {
      const { Attributes: lockInfo } = await this.docs.update({
        TableName: this.LOCKS_TABLE,
        Key: { lock_key: organizationId },
        UpdateExpression: 'SET locked_until = :lockTimeout',
        ConditionExpression: 'attribute_not_exists(locked_until) OR locked_until < :now',
        ExpressionAttributeValues: {
          ':lockTimeout': Date.now() + this.LOCK_TIMEOUT,
          ':now': Date.now()
        },
        ReturnValues: 'ALL_NEW'
      }).promise()
      return lockInfo
    } catch (e) {
      if (e.code === 'ConditionalCheckFailedException') {
        // given that we know exactly why this specific error code will throw
        // i am swallowing the stack and printing just what's important: already locked.
        throw new Error(`Organization id ${organizationId} is already locked`)
      }
      throw e
    }
  }

  async unlockOrg ({ organizationId }) {
    return this.docs.delete({
      TableName: this.LOCKS_TABLE,
      Key: { lock_key: organizationId }
    }).promise()
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
