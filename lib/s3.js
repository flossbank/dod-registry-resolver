class S3 {
  constructor ({ s3, log }) {
    this.s3 = s3
    this.log = log
  }

  async getTopLevelPackages ({ correlationId, searchPatterns }) {
    return Promise.all(searchPatterns.map(async ({ language, registry }) => {
      const params = {
        Bucket: 'org-donation-state',
        Key: `${correlationId}/${language}_${registry}_top_level_packages.json`
      }
      const { Body } = await this.s3.getObject(params).promise()
      return { language, registry, deps: JSON.parse(Body) }
    }))
  }

  async putPackageWeightMaps ({ correlationId, packageWeightMaps }) {
    return Promise.all(packageWeightMaps.map(async ({ language, registry, weightMap }) => {
      const params = {
        Body: JSON.stringify([...weightMap.entries()]),
        Bucket: 'org-donation-state',
        Key: `${correlationId}/${language}_${registry}_package_weight_map.json`
      }
      return this.s3.putObject(params).promise()
    }))
  }
}

module.exports = S3
