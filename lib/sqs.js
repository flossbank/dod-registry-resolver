class Sqs {
  constructor ({ config, sqs }) {
    this.config = config
    this.sqs = sqs
  }

  async sendOrgDistributeDonationMessage (payload) {
    const url = this.config.getOrgDistributeDonationInputQueueUrl()
    return this.sendMessage(url, payload)
  }

  async sendMessage (url, payload) {
    return this.sqs.sendMessage({
      QueueUrl: url,
      MessageBody: JSON.stringify(payload)
    }).promise()
  }
}

module.exports = Sqs
