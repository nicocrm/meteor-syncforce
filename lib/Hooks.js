import {Meteor} from 'meteor/meteor'
import forIn from 'lodash/forIn'
import isEmpty from 'lodash/isEmpty'
import isFunction from 'lodash/isFunction'
import {removeNonSfKeys} from './utility'

// local helper for hooks
class Hooks {
  constructor(syncforce, collection, resource, options = {}) {
    this.collection = collection
    this.syncforce = syncforce
    this.resource = resource
    // suspend hooks cannot work like that because even though we are single threaded the
    // methods can be called multiple times in various async handlers
    // this.suspendHooks = false
    this.collectionHooks = {}
    this.outboundHooks = Object.assign({
      save: {},
      insert: {},
      update: {},
      remove: {}
    }, options.outboundHooks)
  }

  deinit() {
    forIn(this.collectionHooks, hook => {
      hook.remove()
    })
  }

  init() {
    this.collectionHooks = {
      insertHook: this.collection.before.insert(this.onInsert.bind(this)),
      updateHook: this.collection.before.update(this.onUpdate.bind(this)),
      removeHook: this.collection.before.remove(this.onRemove.bind(this)),
      upsertHook: this.collection.before.upsert(this.onUpsert.bind(this))
    }
  }

  onInsert(userId, record) {
    let payload = record
    console.log('onInsert', record);
    // create in SF and populate the ID on the record
    return this._errorHandling(() => {
      if((payload = this._runOutboundHook('save', 'before', payload)) &&
         (payload = this._runOutboundHook('insert', 'before', payload))) {
           const ret = this.syncforce.create(this.resource, removeNonSfKeys(payload))
           // console.log('insert hook', ret)
           record.Id = ret.id

           let modified = this._runOutboundHook('save', 'after', payload)
           modified = this._runOutboundHook('insert', 'after', modified)
           return modified
           // TODO - update record in collection if modified !== payload
         } else {
           return false
         }
    })
  }

  onRemove(userId, record) {
    if (record.Id) {
      if(!this._runOutboundHook('remove', 'before', record))
        return false
      this._errorHandling(() => {
        try {
          this.syncforce.destroy(this.resource, record.Id)
        } catch (e) {
          if (e.errorCode !== 'ENTITY_IS_DELETED')
            // ignore those
            throw e
        }
        this._runOutboundHook('remove', 'after', record)
      })
    }
  }

  onUpdate(userId, record, fieldNames, modifier) {
    if (record.Id && modifier.$set) {
      let payload = removeNonSfKeys(modifier.$set)
      if(isEmpty(payload))
        // let the update proceed, but don't try to send it to SF in that case
        return true
      // console.log('onUpdate');
      return this._errorHandling(() => {
        if ((payload = this._runOutboundHook('save', 'before', payload)) &&
              (payload = this._runOutboundHook('update', 'before', payload))) {
                payload.Id = record.Id
                this.syncforce.update(this.resource, payload)
                let modified = this._runOutboundHook('save', 'after', payload)
                modified = this._runOutboundHook('update', 'after', modified)
                // TODO - update record in collection if modified !== payload
              } else {
                return false
              }
      })
    }
    // should we do an insert if there is no id??
  }

  onUpsert(userId, selector, modifier, options) {
    // I think this would be tricky because we may not be able to run the same
    // query in SF as in Mongo
    // Possibly we could try and run on the after event?
    throw new Meteor.Error('syncforce.notimplemented',
                           'Upsert not implemented')
  }

  _runOutboundHook(operation, stage, record) {
    let hook = this.outboundHooks[operation]
    // if we just pass a function, it will be assumed to be the "before" hook
    if(!isFunction(hook) || stage != 'before'){
      hook = hook[stage]
    }
    if(hook) {
      const result = hook(record)
      if(result !== false)
        return result || record
      return false
    }
    return record
  }

  _errorHandling(fun) {
    try {
      return fun()
    } catch(e) {
      if(e.errorType != 'Meteor.Error') {
        e.sanitizedError = new Meteor.Error(e.toString())
      }
      throw e
    }
  }
}

export default Hooks
