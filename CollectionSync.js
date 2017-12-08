import jsforce from 'jsforce'
// import Future from 'fibers/future'
import {Meteor} from 'meteor/meteor'
import {check} from 'meteor/check'
import isFunction from 'lodash/isFunction'
import isEmpty from 'lodash/isEmpty'
import {removeNonSfKeys, cleanSfRecord} from './lib/utility'
import Logging from './lib/logging'
import Hooks from './lib/Hooks'
import Subscription from './lib/Subscription'
import LookupCollection from './lib/LookupCollection'

const DEFAULT_INTERVAL = 5


// class used to manage the synchronization between a Salesforce resource
// and a Mongo collection
class CollectionSync {
  // @param syncforce Syncforce object
  //    (which is really the same thing as the SyncForce singleton, we just pass it to enable testing)
  // @param collection Mongo.Collection
  // @param resource String SF resource name
  // @param condition String|Object Condition on records to sync
  //          (XXX this is not quite working, because when a record changes and
  //          no longer matches the condition we wont know about it)
  // @param options Object - see documentation in syncforce.js
  constructor(syncforce, collection, resource, condition, options) {
    this.connection = syncforce.getConnection()
    this.syncforce = syncforce
    this.collection = collection
    this.resource = resource
    this.condition = condition
    this.options = Object.assign({
      interval: DEFAULT_INTERVAL,
      fields: null,
      topic: null,
      transform: null,
      onRemoved: null,
      useCollectionHooks: false,
      lookupDefinitions: null,
      timeStampField: 'LastModifiedDate',
      syncDeletedItems: true
    }, options || {})
    this.intervalHandle = null
    this.running = null
    this.lastSync = null
    if (this.options.useCollectionHooks)
      this.collectionHooks = new Hooks(syncforce, collection, resource,
        {outboundHooks: options.outboundHooks})
    if (this.options.topic) {
      this.subscription = new Subscription(this, this.connection, options.topic)
    }
    if (this.options.lookupDefinitions) {
      this.lookups = new LookupCollection(this.collection, this.resource, this.options.lookupDefinitions)
    }
    // TODO: we need to add a unique id index on the collection with "Id"
  }

  start() {
    if (!this.intervalHandle) {
      // TODO: instead of using setInterval we should use a package like job-collection to queue the sync job to be executed outside
      // of this server context (for performance)
      this.intervalHandle = Meteor.setInterval(this.run.bind(this), this.options.interval * 60000)

      if (this.subscription)
        this.subscription.init()
      if (this.collectionHooks)
        this.collectionHooks.init()
      if (this.lookups)
        this.lookups.init(this.syncforce)
    }
    // run automatically?
    this.run()
  }

  stop() {
    if (this.intervalHandle) {
      Meteor.clearInterval(this.intervalHandle)
      this.intervalHandle = null
      if (this.subscription)
        this.subscription.deinit()
      if (this.collectionHooks)
        this.collectionHooks.deinit()
      if (this.lookups)
        this.lookups.deinit(this.syncforce)
    }
  }

  // run the sync asynchronously.
  // If callback is provided it will be invoked when done.
  run(callback) {
    if (this.running)
      return
    var status = {
      updated: 0,
      inserted: 0,
      deleted: 0,
      lastRecordSyncDate: null
    }
    this.running = true
    Logging.debug('Running sync for ' + this.resource)
    var syncStart = new Date()
    var query = this.createQuery()
      .on('record', Meteor.bindEnvironment(record => {
        // XXX error handling?
        try {
          this.processRecord(record, status)
        } catch (e) {
          // mmm not sure how we can report this?
          Logging.error('error in processRecord', e)
        }
      }))
      .on('end', Meteor.bindEnvironment(_ => {
        if (this.options.syncDeletedItems) {
          this.runDeleted(syncStart, status, (err, status) => {
            Logging.debug('Sync %s complete', this.resource, status)
            this.running = false
            if(status.lastRecordSyncDate)
              this.lastSync = new Date(status.lastRecordSyncDate)
            else
              this.lastSync = syncStart
            if (callback)
              callback(err, status)
          })
        }
      }))
      .on('error', Meteor.bindEnvironment(err => {
        this.running = false
        Logging.error('error running sync query for ' + this.resource, err)
        Logging.error('Stack: ', err.stack)
        if (callback)
          callback(err)
      }))
    query.run({autoFetch: true, maxFetch: 500})
  }

  ///////////////////// END PUBLIC API

  // sync items that have been deleted remotely since the last sync.
  runDeleted(syncStart, status, callback) {
    var start = this.lastSync, end = syncStart
    // don't go too far back with the deleted items
    if (!start || start.getTime() < end.getTime() - 10 * 24 * 60 * 60 * 1000)
      start = new Date(syncStart.getFullYear(), syncStart.getMonth(), syncStart.getDate() - 5)
    if (start.getTime() > end.getTime() - 60000) {
      // need to have at least 1 minute difference
      start = new Date(end.getTime() - 60000)
    }
    this.connection.sobject(this.resource)
      .deleted(start.toISOString(), end.toISOString(), Meteor.bindEnvironment((err, res) => {
        if (err) {
          Logging.error('error running deleted items sync', err)
        } else {
          try {
            if (!isEmpty(res.deletedRecords))
              this.processDeletedRecords(res.deletedRecords, status)
          } catch (e) {
            Logging.error('Error processing deleted records', e)
            err = e
          }
        }
        callback(err, status)
      }))
  }

  // create an async query for the object
  // note we do not use syncforce.find because that one is synchronous
  createQuery() {
    var sob = this.connection.sobject(this.resource)
    var q = sob.find(this.createQueryWhere(), this.createQueryFields())
      .sort({[this.options.timeStampField]: 1})
    return q
  }

  createQueryWhere() {
    var where = this.condition
    if (isFunction(where))
      where = where()

    // infer LastSync from the LastModifiedDate in the DB
    if (!this.lastSync) {
      const lastRec = this.collection.findOne({
        [this.options.timeStampField]: {$exists: true}
      }, {
        sort: {[this.options.timeStampField]: -1}
      })
      this.lastSync = lastRec && new Date(lastRec[this.options.timeStampField])
    }
    if (this.lastSync) {
      if (typeof where == 'string') {
        if (where)
          where = '(' + where + ') and '
        // should we take off a few minutes to account for possible skew?
        var last = new Date(this.lastSync.getTime())
        where += this.options.timeStampField + ' > ' +
          jsforce.Date.toDateTimeLiteral(last.toISOString())
      } else {
        where[this.options.timeStampField] = {
          $gt: jsforce.Date.toDateTimeLiteral(this.lastSync.toISOString())
        }
      }
    }
    return where
  }

  createQueryFields() {
    var fields = this.options.fields
    if (!fields)
      return '*'
    check(fields, [String])
    if (fields.indexOf(this.options.timeStampField) == -1)
      fields.push(this.options.timeStampField)
    if (fields.indexOf('Id') == -1)
      fields.push('Id')
    return fields
  }

  /**
   * Process incoming record.
   * This can be an insert or an update.
   * This is called when running the date-based sync, as well as when
   * receiving an event from the streaming API.
   */
  processRecord(record, status) {
    record = cleanSfRecord(record)
    if (this.lookups)
      record = this.lookups.onChildSynced(record)
    if (this.options.transform) {
      var transformed = this.options.transform(record)
      if (transformed === false) {
        Logging.debug('skip insert - transform returned false')
        this.processDeletedRecords([record], status)
        return
      } else if (transformed)
        record = transformed
    }
    // use direct to bypass the hook
    // Ideally we should probably use the SF id as collection id but what would
    // happen if we insert a record on the local db and have it synced later?
    // it still needs an id.  Or maybe we just don't allow that behavior and only
    // insert the records in SF then sync them back.
    //var result = this.collection.upsert({ Id: record.Id }, { $set: record })

    const result = this.collection.direct.upsert({Id: record.Id},
      {$set: record})
    if (result.insertedId) {
      status.inserted += 1
      this.syncforce._notifyReceived('inserted', this.resource, record)
    } else {
      status.updated += 1
      this.syncforce._notifyReceived('updated', this.resource, record)
    }
    status.lastRecordSyncDate = record[this.options.timeStampField]
  }

  /**
   * Process incoming delete (this is a synchronous process)
   * This can also be called, if the transform function returned false in a processRecord
   * handler
   */
  processDeletedRecords(records, status) {
    if (records.length) {
      let toDelete = records
      if (this.options.onRemoved) {
        toDelete = records.filter(r => this.options.onRemoved(r.id || r.Id) !== false)
      }
      const recIds = toDelete.map(r => r.id || r.Id)
      status.deleted += this.collection.direct.remove({Id: {$in: recIds}})
      recIds.forEach(r => {
        this.syncforce._notifyReceived('removed', this.resource, {Id: r})
      })
    }
  }
}

export default CollectionSync
