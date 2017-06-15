import omit from 'lodash/omit'

/**
 * Maintain a M-1 relationship (and optionally the reverse relationship)
 * - when the parent is synced from SF, we can update the lookup on the child record
 * - when the child is synced from SF, we can update the collection on the parent record
 * - for operations within the app, we will update the lookup when the child / parent is
 * re-synced from SF (either immediately with a streaming topic, or on schedule), but will
 * update the related list immediately (via a collection hook).  This lets us handle "cascading" updates -
 * where a change in one lookup needs to be reflected using the related list maintained by another lookup
 */
class Lookup {
  /**
   * @param {Object} options
   * @param {string} options.lookupField - name of the SF field that stores the parent id.  Required.
   * @param {string} options.parentFieldName  - what field to store the parent in this record.
   *       If not provided, parent will not be stored on the child record.
   * @param {string[]} options.parentFields - what parent fields to retrieve and store on the child record.
   *       If not provided, Id and Name will be stored
   *       When provided, Id and Name will be prepended to the array
   * @param {string} options.parentEntity - Name of the Salesforce entity for the parent.  Required.
   * @param {Mongo.Collection} options.parentCollection - collection entity for the parent.  Required.
   * @param {Mongo.Collection} options.childCollection - collection entity for the child.  Required.
   *       This is passed automatically when the Lookup object is instantiated by CollectionSync
   * @param {string} options.relatedListName - Name of the field, on the parent entity, representing the collection of children.
   *       If not provided, the collection will not be stored on the parent.
   *       Does not handle reparenting - if a child's parent is removed or modified the old parent will not be
   *       updated
   * @param {string[]} options.relatedListFields - what child fields to retrieve and store on the parent's collection field.
   *       If not provided, whole record (minus the _id field) will be stored.
   */
  constructor(options) {
    // const {
    //   lookupField, parentFieldName, parentFields, parentEntity, parentCollection,
    //   relatedListName, relatedListFields, childCollection
    // } = options
    Object.assign(this, options)
    if (!this.parentFields) {
      this.parentFields = ['Id', 'Name']
    } else {
      this.parentFields.unshift('Id', 'Name')
    }
  }

  registerEvents(sfSync) {
    sfSync.onSynced('inserted', this.parentEntity, this._onParentInserted.bind(this))
    sfSync.onSynced('updated', this.parentEntity, this._onParentUpdated.bind(this))
    if (this.relatedListName) {
      // need to track internal updates in that case, to update the list on the parent
      this.childCollection.after.update(this._onChildUpdated.bind(this))
      this.childCollection.after.insert(this._onChildUpdated.bind(this))
      this.childCollection.after.remove(this._onChildRemovedHook.bind(this))
    }
  }

  deregister() {

  }

  /**
   * Run transform for incoming record, populating lookup fields as needed.
   * If relatedListName was provided, update the parent collection.
   * In the case of an internal modification, this will be called when the record is synced back into the system
   * (which will be almost immediate when streaming topics are used)
   * Called as a transform operation from CollectionSync.
   */
  onChildSynced(rec) {
    if (rec[this.lookupField]) {
      if (this.parentFieldName) {
        const parent = this.parentCollection.findOne({Id: rec[this.lookupField]})
        if(parent) {
          rec[this.parentFieldName] = extractNamedFields(parent, this.parentFields)
        }
      }
      if (this.relatedListName) {
        // note we don't handle reparenting - or we should remove it from the potential previous parent
        addOrUpdateChildInCollection(rec[this.lookupField], this.relatedListName,
          extractNamedFields(rec, this.relatedListFields), this.parentCollection)
      }
    } else {
      if (this.parentFieldName) {
        rec[this.parentFieldName] = null
      }
    }
    return rec
  }

  /**
   * Update the parent collection.
   * This runs when a delete is synced from Salesforce, or when a record is deleted internally.
   * (called from CollectionSync)
   */
  onChildRemoved(rec) {
    // console.log('trigger onChildRemoved', rec);
    if (this.relatedListName) {
      removeChildFromCollection(rec[this.lookupField], rec.Id, this.relatedListName, this.parentCollection)
    }
  }

  // update the parent lookup field, and also the parent collection,
  // creating it based on existing child records
  _onParentInserted(parent) {
    this._onParentUpdated(parent)
    if (this.relatedListName) {
      // console.log('rebuild list for parent', parent.Id);
      const children = this.childCollection.find({[this.lookupField]: parent.Id})
        .map(c => extractNamedFields(c, this.relatedListFields))
      if (children.length) {
        this.parentCollection.direct.update({Id: parent.Id}, {
          $set: {[this.relatedListName]: children}
        })
      }
    }
  }

  // update the parent lookup field
  _onParentUpdated(parent) {
    // console.log('parent update', parent);
    if (this.parentFieldName) {
      // run the hooks so that other lookups are notified
      // this will also run the collection sync hook, but since we are not including any SF field it won't do anything
      // console.log('parent updated', parent.Id);
      this.childCollection.update({[this.lookupField]: parent.Id}, {
        $set: {[this.parentFieldName]: extractNamedFields(parent, this.parentFields)}
      }, {multi: true})
    }
  }

  // update the parent related lists
  // this runs for internal update operations (including cases where the parent is updated)
  _onChildUpdated(userId, record) {
    // console.log('in child updated hook', record);
    addOrUpdateChildInCollection(record[this.lookupField], this.relatedListName,
      extractNamedFields(record, this.relatedListFields), this.parentCollection)
  }
  
  _onChildRemovedHook(userId, record) {
    this.onChildRemoved(record)
  }
}

function addOrUpdateChildInCollection(parentId, relatedListName, child, parentCollection) {
  if (!parentId)
    return
  // try to update existing child
  // console.log('try to update child id', child.Id);
  if (0 === parentCollection.update({Id: parentId, [relatedListName]: {$elemMatch: {Id: child.Id}}}, {
      $set: {[`${relatedListName}.$`]: child}
    })) {
    // push to array (if the array does not already exist this will create it)
      // console.log('update failed, pushing', child.Id);
    if (0 === parentCollection.update({
      Id: parentId,
      [relatedListName]: {$not: {$elemMatch: {Id: child.Id}}}
    }, {$push: {[relatedListName]: child}})) {
      // console.log('Push failed', child.Id);
    }
  } else {
    // console.log('update succeeded', child.Id);
  }
}

function removeChildFromCollection(parentId, childId, relatedListName, parentCollection) {
  parentCollection.update({Id: parentId}, {$pull: {[relatedListName]: {Id: childId}}})
}

function extractNamedFields(record, fields) {
  if (!record)
    return null
  if (!fields)
    return omit(record, ['_id'])
  return fields.reduce((acc, field) => {
    if (field in record)
      acc[field] = record[field];
    return acc
  }, {})
}

export default Lookup
