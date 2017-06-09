import {Meteor} from 'meteor/meteor'
import {Mongo} from 'meteor/mongo';
import {sinon} from 'meteor/practicalmeteor:sinon';
import {expect} from 'meteor/practicalmeteor:chai'
import Lookup from './Lookup'

describe('Lookup', () => {
  let lookup, parentCollection, childCollection, mockSfSync

  beforeEach(() => {
    parentCollection = new Mongo.Collection(null)
    //noinspection JSDeprecatedSymbols
    parentCollection.insert({Id: 'theparent'})
    childCollection = new Mongo.Collection(null)
    lookup = new Lookup({
      lookupField: 'Parent__c',
      parentFieldName: 'Parent__r',
      parentFields: ['Id', 'Name'],
      parentEntity: 'Parent__c',
      parentCollection,
      childCollection,
      relatedListName: '_children',
      relatedListFields: ['Id', 'Name']
    })
    mockSfSync = {
      onSynced: sinon.spy()
    }
    lookup.registerEvents(mockSfSync)
  })

  it('register events', () => {
    mockSfSync.onSynced.should.be.called
  })

  it('updates the parent collection when a child is updated', () => {
    parentCollection.update({Id: 'theparent'}, {$set: {_children: [{Id: 'thechild', Name: 'Old Name'}]}})
    const child = {Id: 'thechild', Name: 'Child 1', Parent__c: 'theparent'}
    lookup.onChildSynced(child)
    const parent = parentCollection.findOne({Id: 'theparent'})
    parent._children.should.eql([{Id: 'thechild', Name: 'Child 1'}])
  })

  // this does not work, it would require making the update operation smarter, but then we would lose some perf.
  // there is an easy work around, which is to simply put the lookups that are updating related lists at the end of the
  // list of lookup definitions.  But it will fail if there are several lookups with both related list and parent
  // fields
  it.skip('updates the parent collection when a child is updated, without losing fields', () => {
    parentCollection.update({Id: 'theparent'}, {$set: {_children: [{Id: 'thechild', Name: 'Old Name', OtherField: 'something'}]}})
    const child = {Id: 'thechild', Name: 'Child 1', Parent__c: 'theparent'}
    lookup.onChildSynced(child)
    const parent = parentCollection.findOne({Id: 'theparent'})
    parent._children.should.eql([{Id: 'thechild', Name: 'Child 1', OtherField: 'something'}])
  })

  it('updates the parent collection when a child is updated, multiple children', () => {
    parentCollection.update({Id: 'theparent'}, {
      $set: {
        _children: [{Id: 'thechild', Name: 'Old Name'},
          {Id: 'otherchild', Name: 'othername'}]
      }
    })
    const child = {Id: 'thechild', Name: 'Child 1', Parent__c: 'theparent'}
    lookup.onChildSynced(child)
    const parent = parentCollection.findOne({Id: 'theparent'})
    parent._children.should.eql([{Id: 'thechild', Name: 'Child 1'}, {Id: 'otherchild', Name: 'othername'}])
  })

  it('updates the parent collection when a child is inserted', () => {
    const child = {Id: 'thechild', Name: 'Child 1', Parent__c: 'theparent'}
    lookup.onChildSynced(child)
    const parent = parentCollection.findOne({Id: 'theparent'})
    parent.should.have.property('_children')
    parent._children.should.eql([{Id: 'thechild', Name: 'Child 1'}])
  })

  it('adds a new child to parent collection', () => {
    parentCollection.update({Id: 'theparent'}, {$set: {_children: [{Id: 'thechild'}]}})
    const child = {Id: 'thechild2', Name: 'Child 2', Parent__c: 'theparent'}
    lookup.onChildSynced(child)
    const parent = parentCollection.findOne({Id: 'theparent'})
    parent._children.should.eql([{Id: 'thechild'}, {Id: 'thechild2', Name: 'Child 2'}])
  })

  it('updates the parent collection when a child is removed', () => {
    parentCollection.update({Id: 'theparent'}, {$set: {_children: [{Id: 'thechild'}]}})
    const child = {Id: 'thechild', Name: 'Child 1', Parent__c: 'theparent'}
    lookup.onChildRemoved(child)
    const parent = parentCollection.findOne({Id: 'theparent'})
    parent._children.should.eql([])
  })

  it('clears parent lookup when the lookup field is cleared', () => {
    const child = lookup.onChildSynced({Id: 'thechild', Name: 'Child 1', Parent__c: null})
    expect(child.Parent__r).to.equal(null)
  })

  it('does not error when inserting a child without a valid parent', () => {
    lookup.onChildSynced({Id: 'thechild', Name: 'Child 1', Parent__c: 'otherparent'})
  })

  it('updates the parent lookup when the parent is inserted after the child', () => {
    childCollection.insert({Id: 'child1', Parent__c: 'theparent', Parent__r: null})
    childCollection.insert({Id: 'child2', Parent__c: 'theparent'})
    childCollection.insert({Id: 'child3', Parent__c: 'otherparent'})
    lookup._onParentInserted({Id: 'theparent', Name: 'Foo'})
    childCollection.findOne({Id: 'child1'}).should.have.property('Parent__r').that.eql({Id: 'theparent', Name: 'Foo'})
    childCollection.findOne({Id: 'child2'}).should.have.property('Parent__r').that.eql({Id: 'theparent', Name: 'Foo'})
    childCollection.findOne({Id: 'child3'}).should.not.have.property('Parent__r')
  })

  it('updates the parent collection when the parent is inserted after the child', () => {
    childCollection.insert({Id: 'child1', Parent__c: 'theparent', Parent__r: null})
    childCollection.insert({Id: 'child2', Parent__c: 'theparent'})
    childCollection.insert({Id: 'child3', Parent__c: 'otherparent'})
    lookup._onParentInserted({Id: 'theparent', Name: 'Foo'})
    const parent = parentCollection.findOne({Id: 'theparent'})
    expect(parent).to.be.ok
    parent.should.have.property('_children')
    parent._children.should.eql([{Id: 'child1'}, {Id: 'child2'}])
  })

  it('updates the parent lookup when a child is inserted or updated', () => {
    const child = lookup.onChildSynced({Id: 'thechild', Name: 'Child 1', Parent__c: 'theparent'})
    expect(child.Parent__r).to.eql({Id: 'theparent'})
  })

  it('updates the parent collection when the child is modified outside of sync', () => {
    childCollection.insert({Id: 'thechild', Name: 'Director', Parent__c: 'theparent'})
    parentCollection.update({Id: 'theparent'}, {$set: {_children: [{Id: 'thechild', Name: 'Director'}]}})
    childCollection.update({Id: 'thechild'}, {$set: {Name: 'Manager'}})
    const parent = parentCollection.findOne({Id: 'theparent'})
    console.log(parent._children);
    parent._children.should.have.length(1)
    parent._children[0].should.eql({Id: 'thechild', Name: 'Manager'})
  })
})