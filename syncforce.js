import jsforce from 'jsforce'
import {Meteor} from 'meteor/meteor'
import {Mongo} from 'meteor/mongo'
import {check, Match} from 'meteor/check'
import CollectionSync from './CollectionSync'
import MetadataSync from './MetadataSync'
import Logging from './lib/logging'
import { checkNpmVersions } from 'meteor/tmeasday:check-npm-versions';

checkNpmVersions({ 'simpl-schema': '0.x.x', log: '1.x.x' }, 'nicocrm:syncforce');

let connection = null,
  currentSyncs = {}

/**
 * Singleton object used for communicating with Salesforce
 */
const SyncForce = {
  // Setup Salesforce login parameters
  // will throw an exception if connection cannot be established
  login(settings) {
    check(settings, Match.ObjectIncluding({
      user: String,
      password: String,
      token: String,
      login_url: String
    }))

    connection = new jsforce.Connection({
      loginUrl: settings.login_url,
      // version 37 and above have some problem with streaming
      version: '36.0'
    })
    var sync = Meteor.wrapAsync(connection.login, connection)
    var loginResult = sync(settings.user, settings.password + settings.token)
    return connection
  },

  // Optionally, provide a logger object to use.
  // If this is not provided messages will be logged to the console using npm-log.
  // The logger object must have debug, info, warn and error methods.
  setLogger(logger) {
    Logging.setLogger(logger)
  },

  // Return jsforce connection object.
  // This can be used to invoke any operation that is not already exposed by the
  // wrapper, but in that case they also need to be wrapped to be asynchronous.
  getConnection() {
    if (!connection)
      throw new Error('Connection not initialized - call login first')
    return connection
  },

  // Set the connection explicitly (mostly for testing)
  setConnection(conn) {
    connection = conn
  },

  // Setup a synchronized collection
  // The records from Salesforce will be automatically added to the given Mongo
  // collection, and changes to the collection will be reflected in Salesforce.
  //
  // @param collection Object the Mongo collection to sync
  // @param resource String name of the Salesforce resource.  It is not possible
  //          to have multiple sync with the same SF resource.
  // @param condition Object|function|String criteria (@see jsforce#find)
  //          If using a function it must return a criteria object, it
  //          will be evaluated every time the sync is run
  // @param options [Object] Additional parameters
  // @param options.outboundHooks
  //      Allow for transforming the object before sending it to SF, or take
  //      actions on the record after it has been sent.
  //      Can return null/false to cancel the operation (on the before hooks only),
  //      or a modified record.
  //      If a modified record is returned by the before hook, then that data will be
  //      used when sending to SF (except for the remove hook)
  //      If a modified record is returned by the after hook, then that data will be
  //      updated in the local collection (TODO this part not implemeted yet)
  //      - create (before, after)
  //      - update (before, after)
  //      - save (before, after) - used for both create and update, before the more specific hooks run
  //      - remove (before, after) - called when an object is deleted locally
  //      - instead of specifying an object with before and after properties, can also just pass a function -
  //        this will be run as a "before" hook
  // @param options.transform [function]
  //      to be applied for records retrieved from Salesforce before they are inserted
  //      in the local collection.
  //      Can return modified object or false to skip (if false is returned we will
  //      also delete the local copy of the record, if it is already in our side)
  // @param options.onRemoved [function]
  //      to be applied when a record has been deleted in Salesforce.  This is not called
  //      when the record was removed locally.  It will be passed the record id, and if it
  //      returns false, the record will then NOT be deleted locally.
  // @param options.topic [String]
  //      If provided, subscribe to this push topic to listen for data
  //      events.
  //      Care must be taken to ensure all pertinent fields are included when the topic
  //      is registered in SF.
  // @param options.useCollectionHooks [boolean]
  //      If true, collection hooks will be used to automatically send records
  //      that are updated, inserted or deleted locally to Salesforce
  //      Default to false
  // @param options.timeStampField [String] field to use to determine what records to sync.  Defaults to LastModifiedDate.
  //      This field will be added automatically to the fields collection so no need to specify it.
  // @param options.interval [int] sync interval in minutes (default to 5)
  // @param options.fields [String[]] fields to retrieve (default to all)
  syncCollection(collection, resource, condition, options) {
    check(collection, Mongo.Collection)
    check(resource, String)
    check(condition, Match.OneOf(Function, Object, String))
    check(options, {
      topic: Match.Optional(String),
      interval: Match.Optional(Match.Integer),
      transform: Match.Optional(Function),
      onRemoved: Match.Optional(Function),
      fields: Match.Optional([String]),
      useCollectionHooks: Match.Optional(Boolean),
      outboundHooks: Match.Optional(Object),
      timeStampField: Match.Optional(String)
    })

    if (currentSyncs[resource]) {
      currentSyncs[resource].stop()
    }
    var c = new CollectionSync(SyncForce, collection, resource, condition, options)
    // TODO: is it possible to ensure that only one sync runs at a time?
    c.start()
    currentSyncs[resource] = c
    return c
  },

  // Fetch metadata for the specified entities and store it in the given collection
  syncMetadata(collection, metaType, fullNames) {
    check(collection, Mongo.Collection)
    check(metaType, String)
    check(fullNames, [String])
    var c = new MetadataSync(connection, collection, metaType, fullNames)
    c.start()
    currentSyncs['metadata'] = c
    return c
  },

  // trigger sync for an already defined collection sync
  // the sync runs asynchronously but if callback is provided it will
  // be invoked when done
  // @param resource String The name of SF resource to be synced
  runSync(resource, callback) {
    if (currentSyncs[resource]) {
      // XXX maybe we should only do that if they are not
      // subscribed to a push topic?
      currentSyncs[resource].run()
    }
  },

  // Expose synchronous versions of a few jsforce methods

  query(soql) {
    sf = this.getConnection()
    var q = Meteor.wrapAsync(sf.query, sf)
    return q(soql)
  },

  // Invoke apex method.
  // Catch exception and read e.message for the body that was returned by the server.
  apex(method, path, args) {
    var apex = this.getConnection().apex
    if (!apex[method])
      throw new Error('Invalid method ' + method)
    // TODO should we try and wrap this a bit better so we can have the error details?
    var method = Meteor.wrapAsync(apex[method], apex)
    return method(path, args)
    // var fut = new Future()
    // apex[method](path, args, (err, result) => {
    //     console.log('in futrure callback', err ? err.message : ' no error ')
    //     if(err)
    //         fut.throw(err)
    //     else
    //         fut.return(result)
    // })
    // return fut.wait()
  },

  find(entity, conditions, fields) {
    return this._invokeSobjectMethod('find', false, ...arguments)
  },

  // Retrieve a record (id can be a single id or an array)
  retrieve(entity, id) {
    check(id, Match.OneOf(String, [String]))
    return this._invokeSobjectMethod('retrieve', false, ...arguments)
  },

  // Create object in Salesforce.
  // If the entity is currently synced to a collection this will
  // cause an immediate sync
  create(entity, data) {
    check(entity, String)
    check(data, Match.OneOf(Object, [Object]))
    return this._invokeSobjectMethod('create', false, ...arguments)
  },

  // Update a record given its id
  update(entity, data) {
    check(data, Match.ObjectIncluding({Id: String}))
    return this._invokeSobjectMethod('update', false, ...arguments)
  },

  // Upsert a record given an ext id field.
  // data must contain the external id in question
  upsert(entity, data, extIdField) {
    check(data, Match.Where(x => check(x, Object) && !!x[extIdField]))
    return this._invokeSobjectMethod('upsert', true, ...arguments)
  },

  // remove a record given its id (can be an array to remove several)
  destroy(entity, id) {
    check(id, Match.OneOf(String, [String]))
    return this._invokeSobjectMethod('destroy', false, ...arguments)
  },

  _invokeSobjectMethod(method, triggerSync, resource, ...args) {
    // make sure we got the entity name
    check(resource, String)
    var sf = this.getConnection()
    var sobject = sf.sobject(resource)
    var sync = Meteor.wrapAsync(sobject[method], sobject)
    var result = sync.apply(sobject, args)
    if (triggerSync) {
      // XXX this will force a sync... maybe we should make that conditional
      // so that we don't run a sync when there is a change that originated from our side anyway?
      this.runSync(resource)
    }
    return result
  }
}

// Variables exported by this module can be imported by other packages and
// applications. See salesforcesync-tests.js for an example of importing.
export default SyncForce
