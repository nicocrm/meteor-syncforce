import Lookup from './Lookup'

class LookupCollection {
  constructor(collection, lookupDefinitions) {
    this.lookups = lookupDefinitions
      // // make sure the elements with a relatedListName come last
      .sort((a, b) => a.relatedListName ? 1 : -1)
      .map(lookupDefinition => new Lookup({
        ...lookupDefinition,
        childCollection: collection
      }))
  }

  init(sfSync) {
    this.lookups.forEach(l => l.registerEvents(sfSync))
  }

  deinit(sfSync) {
    this.lookups.forEach(l => l.deregister(sfSync))
  }

  onChildSynced(child) {
    this.lookups.forEach(l => {
      child = l.onChildSynced(child)
    })
    return child
  }

  onChildRemoved(child) {
    this.lookups.forEach(l => l.onChildRemoved(child))
  }
}

export default LookupCollection