import jsforce from 'jsforce'
import {Meteor} from 'meteor/meteor'
import {Mongo} from 'meteor/mongo'
import {check, Match} from 'meteor/check'
import CollectionSync from './CollectionSync'
import MetadataSync from './MetadataSync'
import Logging from './lib/logging'
import isArray from 'lodash/isArray'
import {checkNpmVersions} from 'meteor/tmeasday:check-npm-versions';
import EventEmitter from 'events'

// checkNpmVersions({'simpl-schema': '0.x.x', log: '1.x.x', lodash: '4.x.x'}, 'nicocrm:syncforce');
// Not sure why, but the lodash check always fails.
checkNpmVersions({'simpl-schema': '0.x.x', log: '1.x.x'}, 'nicocrm:syncforce');

let _currentSyncs = {},
  _connectionOptions = null,
  _syncEvents = new EventEmitter()

/**
 * Singleton object used for communicating with Salesforce
 */
const SyncForce = {
  // Setup Salesforce login parameters
  // will throw an exception if connection cannot be established
  login(settings) {
    check(settings, Match.ObjectIncluding({
      // TODO need to update to use the OAuth2 flow
      // this will let us get a refresh token instead of relying on session ids (which can expire)
      user: String,
      password: String,
      token: String,  // security token
      login_url: String,
      // If oauth settings are passed they will be used to capture a refresh token
      // (TODO need to test this part)
      oauth2: Match.Optional({
        clientId: String,
        clientSecret: String,
        // this must be specified, but you can pass something like http://localhost
        redirectUri: String
      })
    }))
    const con = new jsforce.Connection({
      loginUrl: settings.login_url,
      version: '39.0',
      oauth2: settings.oauth2
    })
    //  TODO instead of calling login every time we should capture the access token
    // the first time and reuse it
    const sync = Meteor.wrapAsync(con.login, con)
    sync(settings.user, settings.password + settings.token)
    // build up options that will be used to create connections in getConnection()
    _connectionOptions = {
      version: '36.0',
      instanceUrl: con.instanceUrl,
      accessToken: con.accessToken,
      // refreshtoken will not be available, unless oauth2 settings are used
      refreshToken: con.refreshToken
    }
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
  // This uses a shared access token - do not call logout!
  getConnection() {
    if (!_connectionOptions)
      throw new Error('Connection not initialized - call login first')
    return new jsforce.Connection(_connectionOptions)
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
  //      NOTE: when the function is involved as a result of a streaming event, not all properties may be present
  //      on the record!
  // @param options.lookupDefinitions [Object[]]
  //      An object defining the relationships to other entities to be maintained automatically.
  //      The related fields will be maintained whenever the parent record or child record is synced.
  //      See Lookup.js for available options
  // @param options.onRemoved [function]
  //      to be applied when a record has been deleted in Salesforce.  This is not called
  //      when the record was removed locally.  It will be passed the record id, and if it
  //      returns false, the record will then NOT be deleted locally.
  // @param options.syncDeletedItems [boolean]
  //      If false, do not attempt to sync deleted items (default to true)
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
      syncDeletedItems: Match.Optional(Boolean),
      outboundHooks: Match.Optional(Object),
      lookupDefinitions: Match.Optional([{
        lookupField: String,
        parentCollection: Mongo.Collection,
        parentEntity: String,
        parentFieldName: Match.Optional(String),
        parentFields: Match.Optional([String]),
        relatedListName: Match.Optional(String),
        relatedListFields: Match.Optional([String]),
      }]),
      timeStampField: Match.Optional(String)
    })

    if (_currentSyncs[resource]) {
      _currentSyncs[resource].stop()
    }
    const c = new CollectionSync(SyncForce, collection, resource, condition, options)
    // TODO: is it possible to ensure that only one sync runs at a time?
    c.start()
    _currentSyncs[resource] = c
    return c
  },

  // Fetch metadata for the specified entities and store it in the given collection
  syncMetadata(collection, metaType, fullNames) {
    check(collection, Mongo.Collection)
    check(metaType, String)
    check(fullNames, [String])
    const c = new MetadataSync(SyncForce, collection, metaType, fullNames)
    c.start()
    _currentSyncs['metadata'] = c
    return c
  },

  // trigger sync for an already defined collection sync
  // the sync runs asynchronously but if callback is provided it will
  // be invoked when done
  // @param resource String The name of SF resource to be synced
  runSync(resource, callback) {
    if (_currentSyncs[resource]) {
      // XXX maybe we should only do that if they are not
      // subscribed to a push topic?
      _currentSyncs[resource].run()
    }
  },

  /**
   * Register a handler to be called when a resource is synced FROM Salesforce.
   *
   * @param {string|string[]} eventType - "updated", "inserted" or "removed"
   * @param {string} resourceType - name of Salesforce resource
   * @param {function} handler - function that will receive an object with {record, eventType, resourceType}
   *    Note that the record passed to the "removed" handler will only contain an Id property
   */
  onReceived(eventType, resourceType, handler) {
    if (!isArray(eventType)) {
      eventType = [eventType]
    }
    eventType.forEach(event => _syncEvents.on(event + ':' + resourceType, handler))
  },

  /**
   * Invoked by the collection sync to trigger on synced events
   *
   * @param {string} eventType
   * @param {string} resourceType
   * @param {object} record
   */
  _notifyReceived(eventType, resourceType, record) {
    _syncEvents.emit(eventType + ':' + resourceType, record, {eventType, resourceType})
  },

  // Expose synchronous versions of a few jsforce methods

  query(soql) {
    const sf = this.getConnection()
    return Meteor.wrapAsync(sf.query, sf)(soql)
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
