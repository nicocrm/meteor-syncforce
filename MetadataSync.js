import Logging from './lib/logging'
import {Meteor} from 'meteor/meteor'
import isArray from 'lodash/isArray'

const DEFAULT_INTERVAL = 30

// used to manage a regular interval sync between Salesforce metadata and a local
// Mongo collection
// the records in the collection will be indexed using the fullName property
class MetadataSync {
  constructor(syncforce, collection, metaType, fullNames) {
    this.connection = syncforce.getConnection()
    this.collection = collection
    this.metaType = metaType
    this.fullNames = fullNames
    this.intervalHandle = null
    this.running = null
  }

  start() {
    if (!this.intervalHandle) {
      this.intervalHandle = Meteor.setInterval(this.run.bind(this), DEFAULT_INTERVAL * 60000)
    }
    // run now
    this.run()
  }

  stop() {
    if (this.intervalHandle) {
      Meteor.clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  run() {
    if(this.running)
      return
    this.running = true
    Logging.debug('Running ' + this.metaType + ' metadata sync for ' + this.fullNames.join(', '))
    var syncRead = Meteor.wrapAsync(this.connection.metadata.read, this.connection.metadata)
    try {
      let result = syncRead(this.metaType, this.fullNames)
      if(!isArray(result))
        result = [result]
      const status = this.processResults(result)
      Logging.debug('Sync ' + this.metaType + ' metadata complete', status)
    } catch(err) {
      Logging.error('Error running ' + this.metaType + ' metadata sync', err)
    }
    this.running = false
  }

  processResults(result) {
    const status = {
      updated: 0,
      inserted: 0
    }
    result.forEach(meta => {
      const r = this.collection.upsert({ fullName: meta.fullName }, {
        $set: { ...meta, metaDataType: this.metaType }
      })
      if(r.insertedId) {
        status.inserted++
      } else {
        status.updated++
      }
    })
    return status
  }
}

export default MetadataSync
