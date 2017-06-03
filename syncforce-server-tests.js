import {Meteor} from 'meteor/meteor'
import {Mongo} from 'meteor/mongo';
import {sinon} from 'meteor/practicalmeteor:sinon';
import {expect} from 'meteor/practicalmeteor:chai'
// Import and rename a variable exported by syncforce.js.
//import {SyncForce} from 'meteor/nicocrm:syncforce'
//import {SyncForce} from './syncforce-server'
import {SyncForce} from 'meteor/nicocrm:syncforce'
import Hooks from './lib/Hooks'
import CollectionSync from './CollectionSync'
import EventEmitter from 'events'

describe('SyncForce', () => {
  const fakeConnection = {}

  beforeEach(() => {
    SyncForce.getConnection = () => fakeConnection
  })

  it('should be defined', () => {
    expect(SyncForce).to.be.ok
  })

  describe('CollectionSync', () => {
    let collection, findEmitter, sobjectMock, connectionMock, sfMock

    beforeEach(() => {
      // setup default versions of the mocks...
      collection = new Mongo.Collection(null)
      findEmitter = new EventEmitter()
      findEmitter.sort = sinon.stub().returns(findEmitter)
      findEmitter.run = sinon.stub()
      sobjectMock = {
        find: sinon.stub().returns(findEmitter),
        deleted: sinon.stub().yields(null, {deletedRecords: []})
      }
      connectionMock = {
        sobject: () => sobjectMock
      }
      sfMock = {
        getConnection: () => connectionMock,
        _notifySynced: sinon.stub()
      }
    })

    it('should sync new records from SF', sinon.test(function() {
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {})
      const callback = sinon.stub()
      // send records when query runs
      findEmitter.run = () => {
        findEmitter.emit('record', {
          Name: 'new account'
        })
        findEmitter.emit('end')
      }
      // run it
      collectionSync.run(callback)

      // check results
      expect(callback).to.have.been.called
      expect(collection.findOne({Name: 'new account'})).to.be.ok
      expect(collectionSync.running).to.equal(false)
    }))

    it('should report error to callback', () => {
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {})
      const callback = sinon.stub()
      // send records when query runs
      findEmitter.run = () => {
        findEmitter.emit('error', 'oh noes')
      }
      // run it
      collectionSync.run(callback)

      // check results
      expect(callback).to.have.been.calledWith('oh noes')
    })

    // note this one can fail when the test does a large number of outputs (eg logs) for each insert call
    it('should sync large number of new records', sinon.test(function() {
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {})
      const callback = sinon.stub()
      // send records when query runs
      findEmitter.run = () => {
        for(let i=0; i < 10000; i++) {
          findEmitter.emit('record', {
            Name: 'new account ' + i
          })
        }
        findEmitter.emit('end')
      }
      // run it
      collectionSync.run(callback)

      // check results
      expect(callback).to.have.been.called
      expect(collection.findOne({Name: 'new account 9999'})).to.be.ok
      expect(collectionSync.running).to.equal(false)
    }))

    it('should run transform on incoming records', () => {
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {
        transform: rec => {
          rec.Testing = 'foo'
        }
      })
      // send records when query runs
      findEmitter.run = () => {
        findEmitter.emit('record', {
          Name: 'new account'
        })
        findEmitter.emit('end')
      }
      // run it
      collectionSync.run()

      // check results
      expect(collection.findOne({Name: 'new account'})).to.be.ok
        .and.to.have.property('Testing')
        .that.equals('foo')
    })

    it('should run onRemoved method when a record is removed from SF', () => {
      const onRemoved = sinon.stub()
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {
        onRemoved
      })
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      findEmitter.run = () => {
        findEmitter.emit('end')
      }

      sobjectMock.deleted = sinon.stub().yields(null, {deletedRecords: [{Id: 'SFID'}]})
      // run it
      collectionSync.run()
      // check that the method was called
      expect(onRemoved).to.have.been.called
    })

    it('should send sync event when a record is removed from SF', () => {
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {
      })
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      findEmitter.run = () => {
        findEmitter.emit('end')
      }
      sobjectMock.deleted = sinon.stub().yields(null, {deletedRecords: [{Id: 'SFID'}]})
      // run it
      collectionSync.run()
      // check that the method was called
      expect(sfMock._notifySynced).to.have.been.called
    })

    it('should not delete if onRemoved return false', () => {
      // get onRemoved to return false for the "SFID" record
      const onRemoved = id => id !== 'SFID'
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {
        onRemoved
      })
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      collection.insert({
        Testing: '123456', Id: 'OTHERID'
      })
      findEmitter.run = () => {
        findEmitter.emit('end')
      }

      sobjectMock.deleted = sinon.stub().yields(null, {deletedRecords: [{Id: 'SFID'}, {Id: 'OTHERID'}]})
      // run it
      collectionSync.run()

      // check that we did not delete SFID, and we did delete OTHERID
      expect(collection.findOne({Id: 'SFID'}), 'Should not delete SFID').to.be.ok
      expect(collection.findOne({Id: 'OTHERID'}), 'Should delete other one').to.not.be.ok
    })

    it('should update records when push topic received', () => {
      // TODO
    })

    it('should use last modified date to run query', () => {
      const collectionSync = new CollectionSync(sfMock, collection, 'Account', '', {
        timeStampField: 'ModifyDate'
      })
      collection.insert({Name: 'something something', ModifyDate: '2016-03-03T12:00:00Z' })
      collectionSync.run()

      expect(sobjectMock.find)
      // we take out a few minutes, so can't do an exact match
        .to.have.been.calledWithMatch(/ModifyDate >= 2016-03-03T.*/, '*')

    })
  })

  describe('syncMetadata', () => {
    it('should sync picklists from SF', () => {
      fakeConnection.metadata = {
        read: sinon.stub().yields(null, [
          { fullName: 'Account', fields: [1,2] }
        ])
      }
      const Metadata = new Mongo.Collection(null)
      SyncForce.syncMetadata(Metadata, 'CustomObject', ['Account'])
      const accountMeta = Metadata.findOne({fullName: 'Account'})
      expect(accountMeta).to.be.ok
      expect(accountMeta.fields).to.have.length(2)
    })
  })

  describe('CollectionHooks', () => {
    it('should run hook on insert, and populate id', () => {
      const collection = new Mongo.Collection(null)
      const syncforce = {
        create: sinon.stub().returns({ id: '123' })
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName')
      hook.init()
      collection.insert({
        Testing: true
      })
      expect(syncforce.create).to.have.been.calledWith('ResourceName', {Testing: true})
      const rec = collection.findOne({})
      expect(rec.Id).to.equal('123')
    })

    it('should insert object with complex property, but not send them to Salesforce', () => {
      const collection = new Mongo.Collection(null)
      const syncforce = {
        create: sinon.stub().returns({ id: '123' })
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName')
      hook.init()
      collection.insert({
        Testing: true,
        OtherProperty: { somethingelse: true }
      })
      expect(syncforce.create).to.have.been.calledWith('ResourceName', {Testing: true})
      const rec = collection.findOne({})
      expect(rec.Id).to.equal('123')
      expect(rec.OtherProperty).to.eql({somethingelse: true})
    })

    it('should not send update to SF when there is no SF data', () => {
      const collection = new Mongo.Collection(null)
      const syncforce = {
        create: sinon.stub().returns({ id: '123' }),
        update: sinon.stub()
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName')
      hook.init()
      collection.insert({
        Testing: true
      })
      collection.update({Id: '123'}, {$set: { OtherProperty: {somethingelse: true }}})
      expect(syncforce.create).to.have.been.calledWith('ResourceName', {Testing: true})
      const rec = collection.findOne({Id: '123'})
      expect(syncforce.update).to.not.have.been.called
      expect(rec.OtherProperty, 'it should still update in mongo').to.eql({somethingelse: true})
    })

    it('should run outbound hooks on insert, skip insert if return false', () => {
      const collection = new Mongo.Collection(null)
      const syncforce = {
        create: sinon.stub().returns({ id: '123' })
      }
      const outboundHooks = {
        insert: sinon.stub().returns(false)
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName', {
        outboundHooks: outboundHooks
      })
      hook.init()
      collection.insert({
        Testing: true
      })
      expect(outboundHooks.insert).to.have.been.called
      expect(syncforce.create).to.not.have.been.called
      const rec = collection.findOne({})
      expect(rec, 'we should not have created record').to.not.be.ok
    })

    it('should run outbound hooks on create, use modified record, but do not carry those modifications to the DB', () => {
      const collection = new Mongo.Collection(null)
      const syncforce = {
        create: sinon.stub().returns({ id: '123' })
      }
      const outboundHooks = {
        insert: {
          before: rec => ({...rec, Name: 'foo'})
        }
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName', {
        outboundHooks: outboundHooks
      })
      hook.init()
      collection.insert({
        Testing: true
      })
      expect(syncforce.create).to.have.been.calledWith('ResourceName', {
        Testing: true, Name: 'foo'
      })
      const rec = collection.findOne({})
      expect(rec, 'we should not carry over mod to the local DB').to.be.ok
        .and.to.not.have.property('Name')
    })

    it('should run outbound hooks on update', () => {
      const collection = new Mongo.Collection(null)
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      const syncforce = {
        update: sinon.stub().returns({ id: '123' })
      }
      const outboundHooks = {
        update: {
          before: rec => ({...rec, Name: 'foo'})
        }
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName', {
        outboundHooks: outboundHooks
      })
      hook.init()
      collection.update({ Testing: '123456' }, {$set: { Stuff: 'whatever' }})
      expect(syncforce.update).to.have.been.called
      const rec = collection.findOne({Testing: '123456'})
      expect(rec).to.be.ok.and.to.not.have.property('Name')
    })

    it('should run outbound save hooks on update', () => {
      const collection = new Mongo.Collection(null)
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      const syncforce = {
        update: sinon.stub().returns({ id: '123' })
      }
      const outboundHooks = {
        save: {
          before: rec => ({...rec, Name: 'foo'})
        }
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName', {
        outboundHooks: outboundHooks
      })
      hook.init()
      collection.update({ Testing: '123456' }, {$set: { Stuff: 'whatever' }})
      expect(syncforce.update).to.have.been.called
      const rec = collection.findOne({Testing: '123456'})
      expect(rec).to.be.ok.and.to.not.have.property('Name')
    })

    it('should run outbound hooks on update, cancel update if false', () => {
      const collection = new Mongo.Collection(null)
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      const syncforce = {
        update: sinon.stub().returns({ id: '123' })
      }
      const outboundHooks = {
        update: rec => false
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName', {
        outboundHooks: outboundHooks
      })
      hook.init()
      collection.update({ Testing: '123456' }, {$set: { Stuff: 'whatever' }})
      expect(syncforce.update).to.not.have.been.called
      const rec = collection.findOne({Testing: '123456'})
      expect(rec).to.be.ok.and.to.not.have.property('Stuff')
    })

    it('should run outbound hooks on delete', () => {
      const collection = new Mongo.Collection(null)
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      const syncforce = {
        destroy: sinon.stub().returns({ id: '123' })
      }
      const outboundHooks = {
        remove: sinon.stub()
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName', {
        outboundHooks: outboundHooks
      })
      hook.init()
      collection.remove({ Testing: '123456' })
      expect(syncforce.destroy).to.have.been.called
      expect(outboundHooks.remove).to.have.been.called
      const rec = collection.findOne({Testing: '123456'})
      expect(rec).to.not.be.ok
    })

    it('should run outbound hooks on delete, cancel delete if false', () => {
      const collection = new Mongo.Collection(null)
      collection.insert({
        Testing: '123456', Id: 'SFID'
      })
      const syncforce = {
        destroy: sinon.stub().returns({ id: '123' })
      }
      const outboundHooks = {
        remove: sinon.stub().returns(false)
      }
      const hook = new Hooks(syncforce, collection, 'ResourceName', {
        outboundHooks: outboundHooks
      })
      hook.init()
      collection.remove({ Testing: '123456' })
      expect(syncforce.destroy).to.not.have.been.called
      const rec = collection.findOne({Testing: '123456'})
      expect(rec).to.be.ok
    })
  })
})
