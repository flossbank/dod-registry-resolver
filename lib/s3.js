class S3 {
  constructor ({ s3, log }) {
    this.s3 = s3
    this.log = log
  }

  async getTopLevelPackages ({ correlationId, searchPatterns }) {
    return Promise.all(searchPatterns.map(async ({ language, registry }) => {
      const params = {
        Bucket: 'org_donation_state',
        Key: `${correlationId}/${language}_${registry}_top_level_packages.json`
      }
      const { Body } = await this.s3.getObject(params).promise()
      return { language, registry, deps: JSON.parse(Body) }
    }))
  }
}

module.exports = S3
